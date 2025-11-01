import {
  AppStateSingleton,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  generateHelpText,
  log,
  red,
  simpleTemplate,
} from "../libs/core";
import { buildImageContent, dummy, getPresetHelpText, LLM, stripGarbageNewLines, validateFiles } from "../libs/LLM";
import type { Command, ConfigModelVariant, LLMConfigurableProps, Message, PromptParam } from "../libs/types";

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
      apikey: { type: "string", short: "k", default: appConfig.FALLBACK_VALUES.apiKey },
      reason: { type: "boolean", short: "r" },
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
      allowPositionals: (this.constructor as typeof OneShotCommand).allowPositionals,
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
      text = stripGarbageNewLines(await Bun.stdin.text());
    } else if (argValues.file) {
      const fpath = argValues.file;
      const file = Bun.file(fpath);
      if (await file.exists()) {
        await validateFiles(fpath);
        text = stripGarbageNewLines(await file.text());
      } else {
        throw createError(simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: fpath }), {
          code: "SOURCE_FILE_NOT_FOUND",
        });
      }
    }

    if (!positionals[1]) {
      exitOne();
      oneshotHelp();
      errlog(red(appState.s.e.lllm.promptMissing));
      return 1;
    }
    const prompt = `${appConfig.TERMINAL_PREPEND}\n${positionals[1]}`;

    const paramsKey = argValues.params;
    const modelConfig = appConfig.PARAM_CONFIGS[paramsKey];
    if (!modelConfig) {
      throw createError(simpleTemplate(appState.s.e.lllm.undefinedParam, { ParamKey: paramsKey }), {
        code: "UNDEFINED_PARAM",
      });
    }

    let activeConfig: ConfigModelVariant;
    const useReasoning = !!argValues.reason;

    switch (modelConfig.reasoningType) {
      case "reason_and_instruct":
        activeConfig = useReasoning ? modelConfig.reasoning : modelConfig.instruct;
        break;
      case "instruct_only":
        activeConfig = modelConfig.default;
        if (useReasoning) {
          log(simpleTemplate(appState.s.e.lllm.reasoningNotSupported, { Model: paramsKey }));
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

    const promptSettings = activeConfig.prompt;
    const roletag = (promptSettings.defSys[2] as string) || "system";
    const roletag2 = (promptSettings.defPrep[2] as string) || "user";

    let sysPromptFinal: PromptParam = appConfig.EMPTY_FIELD;
    let prependPromptFinal: PromptParam = appConfig.EMPTY_FIELD;

    const useDefaultSystemPrompt = promptSettings.defSys?.at(-1);
    const useDefaultPrepPrompt = promptSettings.defPrep?.at(-1);

    if (useDefaultSystemPrompt) {
      sysPromptFinal = [true, promptSettings.defSys[1], roletag, true];
    }

    const fullUserPrompt = [prompt, text].filter(Boolean).join("\n\n");

    if (fullUserPrompt) {
      prependPromptFinal = [true, fullUserPrompt, roletag2, false];
    } else if (useDefaultPrepPrompt) {
      prependPromptFinal = [true, promptSettings.defPrep[1], roletag2, true];
    } else {
      prependPromptFinal = [true, appConfig.DEFAULT_TF_PROMPT, roletag2, false];
    }

    const llmModelParams = { ...activeConfig.model };
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

    const initArgs: [LLMConfigurableProps, ((messages: Message[]) => Promise<string>)?] = [options];
    if (appState.DEBUG_MODE) {
      initArgs.push(dummy);
    }

    const llm = new LLM(...initArgs);
    const messages = llm.formatMessages("");
    const responseText = await llm.completion(messages, { verbose: true });
    if (appState.DEBUG_MODE) {
      log(responseText);
    }
    return 0;
  }
}
