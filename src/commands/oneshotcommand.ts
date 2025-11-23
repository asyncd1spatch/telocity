import { readFile, writeFile } from "node:fs/promises";
import {
  config as appConfig,
  AppStateSingleton,
  createError,
  errlog,
  exitOne,
  generateHelpText,
  isEexistError,
  isEnoentError,
  log,
  customParseArgs as parseArgs,
  readStdin,
  red,
  simpleTemplate,
} from "../libs/core/index.ts";
import {
  buildImageContent,
  dummy,
  getPresetHelpText,
  LLM,
  stripGarbageNewLines,
  validateFiles,
} from "../libs/LLM/index.ts";
import type {
  Command,
  ConfigModelVariant,
  LLMConfigurableProps,
  Message,
  PromptParam,
} from "../libs/types/index.ts";

export default class OneShotCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return { DefaultModel: appConfig.DEFAULT_MODEL };
  }
  static get options() {
    return {
      file: { type: "string", short: "i" },
      image: { type: "string", short: "I" },
      model: { type: "string", short: "m" },
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      url: { type: "string", short: "u" },
      apikey: {
        type: "string",
        short: "k",
        default: appConfig.FALLBACK_VALUES.apiKey,
      },
      reason: { type: "boolean", short: "r" },
      budget: { type: "string", short: "g" },
      help: { type: "boolean", short: "h" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const internalOptions = {
      debug: { type: "boolean", short: "d" },
    } as const;
    const optionsForParser = {
      ...(this.constructor as typeof OneShotCommand).options,
      ...internalOptions,
    };
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: optionsForParser,
      allowPositionals: (this.constructor as typeof OneShotCommand)
        .allowPositionals,
      strict: true,
    });

    const chunkSize = "200000";
    const batchSize = "1";
    const parallel = "1";
    let text = "";

    const oneshotHelp = () => {
      const replacements = {
        ModelParamList: getPresetHelpText(appConfig.PARAM_CONFIGS),
        ChunkSize: chunkSize,
        BatchSize: batchSize,
        DefaultModel: appConfig.DEFAULT_MODEL,
      };
      const helpText = generateHelpText(
        appState.s.help.commands.os,
        (this.constructor as typeof OneShotCommand).options,
        replacements,
      );
      log(helpText);
    };

    if (argValues.help) {
      oneshotHelp();
      return 0;
    }

    const imageURIs = await buildImageContent(argValues.image as string);

    if (!process.stdin.isTTY) {
      text = stripGarbageNewLines(await readStdin());
    } else if (argValues.file) {
      const fpath = argValues.file;
      try {
        const rawFileContent = await readFile(fpath, "utf-8");
        await validateFiles(fpath);
        text = stripGarbageNewLines(rawFileContent);
      } catch (err) {
        if (isEnoentError(err)) {
          throw createError(
            simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: fpath }),
            {
              code: "SOURCE_FILE_NOT_FOUND",
              cause: err,
            },
          );
        }
        throw err;
      }
    }

    if (!positionals[1] && !text) {
      exitOne();
      oneshotHelp();
      errlog(red(appState.s.e.lllm.promptMissing));
      return 1;
    }

    const positionalPrompt = positionals[1] || "";
    const combinedContent = [positionalPrompt, text]
      .filter(Boolean)
      .join("\n\n");

    let fullUserPrompt = combinedContent;
    if (appConfig.TERMINAL_PREPEND && combinedContent) {
      fullUserPrompt = `${appConfig.TERMINAL_PREPEND}${combinedContent}`;
    }

    const paramsKey = argValues.params;
    const modelConfig = appConfig.PARAM_CONFIGS[paramsKey];
    if (!modelConfig) {
      throw createError(
        simpleTemplate(appState.s.e.lllm.undefinedParam, {
          ParamKey: paramsKey,
        }),
        {
          code: "UNDEFINED_PARAM",
        },
      );
    }

    let activeConfig: ConfigModelVariant;
    const useReasoning = !!argValues.reason;

    switch (modelConfig.reasoningType) {
      case "reason_and_instruct":
        activeConfig = useReasoning
          ? modelConfig.reasoning
          : modelConfig.instruct;
        break;
      case "instruct_only":
        activeConfig = modelConfig.default;
        if (useReasoning) {
          log(
            simpleTemplate(appState.s.e.lllm.reasoningNotSupported, {
              Model: paramsKey,
            }),
          );
        }
        break;
      case "reason_only":
        activeConfig = modelConfig.default;
        break;
      default:
        throw createError(
          simpleTemplate(appState.s.e.lllm.invalidReasoningType, {
            Model: paramsKey,
            Type: String(modelConfig),
          }),
          { code: "INVALID_REASONING_TYPE" },
        );
    }

    const llmModelParams = { ...activeConfig.model };
    const presetChatTemplateKwargs = llmModelParams.chat_template_kwargs;

    if (
      presetChatTemplateKwargs?.[0] &&
      presetChatTemplateKwargs[1]?.["reasoning_effort"]
    ) {
      let reasoningEffort: "low" | "medium" | "high";
      const budgetMap: Record<string, "low" | "medium" | "high"> = {
        "1": "low",
        "2": "medium",
        "3": "high",
      };
      const budgetValue = argValues.budget;

      if (useReasoning) {
        if (budgetValue && budgetMap[budgetValue]) {
          reasoningEffort = budgetMap[budgetValue];
        } else {
          const presetEffort = presetChatTemplateKwargs[1][
            "reasoning_effort"
          ] as "low" | "medium" | "high";
          reasoningEffort = presetEffort === "low" ? "medium" : presetEffort;
        }
      } else {
        reasoningEffort = "low";
      }

      llmModelParams.chat_template_kwargs = [
        true,
        {
          ...presetChatTemplateKwargs[1],
          reasoning_effort: reasoningEffort,
        },
      ];
    }

    const promptSettings = activeConfig.prompt;
    const roletag = (promptSettings.defSys[2] as string) || "system";
    const roletag2 = (promptSettings.defPrep[2] as string) || "user";

    let sysPromptFinal: PromptParam = appConfig.EMPTY_FIELD;
    let prependPromptFinal: PromptParam = appConfig.EMPTY_FIELD;

    const useDefaultSystemPrompt = promptSettings.defSys?.at(-1);

    if (useDefaultSystemPrompt) {
      sysPromptFinal = [true, promptSettings.defSys[1], roletag, true];
    }

    prependPromptFinal = [true, fullUserPrompt, roletag2, false];

    const options: LLMConfigurableProps = {
      chunkSize: Number(chunkSize),
      batchSize: Number(batchSize),
      concurrency: Number(parallel),
      apiKey: argValues.apikey,
      systemPrompt: sysPromptFinal,
      prependPrompt: prependPromptFinal,
      ...llmModelParams,
      url: argValues.url || llmModelParams.url || appConfig.FALLBACK_VALUES.url,
      model: argValues.model ? [true, argValues.model] : llmModelParams.model,
    };

    if (Array.isArray(imageURIs) && imageURIs.length > 0) {
      options.images = imageURIs;
    }

    const initArgs: [
      LLMConfigurableProps,
      ((messages: Message[]) => Promise<string>)?,
    ] = [options];
    if (appState.DEBUG_MODE) {
      initArgs.push(dummy);
    }

    const llm = new LLM(...initArgs);
    const messages = llm.newPrompt("");

    let responseText;
    if (positionals[2]) {
      responseText = await llm.completion(messages, { verbose: false });

      try {
        await writeFile(positionals[2], responseText, { flag: "wx" });
      } catch (err) {
        if (isEexistError(err)) {
          throw createError(
            simpleTemplate(appState.s.e.lllm.targetFileExists, {
              TargetPath: positionals[2],
            }),
            { code: "TARGET_EXISTS", cause: err },
          );
        }
        throw err;
      }
    } else {
      responseText = await llm.completion(messages, { verbose: true });
    }

    if (appState.DEBUG_MODE && typeof responseText === "string") {
      log(responseText);
    }
    return 0;
  }
}
