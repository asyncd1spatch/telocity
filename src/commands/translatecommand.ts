import {
  config as appConfig,
  AppStateSingleton,
  createError,
  exitOne,
  generateHelpText,
  isNodeError,
  log,
  customParseArgs as parseArgs,
  simpleTemplate,
} from "../libs/core/index.ts";
import {
  buildTranslationInstructions,
  dummy,
  getDefaultModelParam,
  getPresetHelpText,
  LLMBATCHERUI,
  resolveModelConfig,
  stripGarbageNewLines,
} from "../libs/LLM/index.ts";
import type {
  Command,
  LLMConfigurableProps,
  Message,
  PromptParam,
} from "../libs/types/index.ts";
import { EMPTY_FIELD } from "../libs/types/index.ts";

export default class TranslateCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return {
      ChunkSize: getDefaultModelParam("chunkSize"),
      BatchSize: getDefaultModelParam("batchSize"),
      Parallel: getDefaultModelParam("parallel"),
      Delay: getDefaultModelParam("delay"),
      SourceLanguage: appConfig.SOURCE_LANGUAGE,
      TargetLanguage: appConfig.TARGET_LANGUAGE,
      DefaultModel: appConfig.DEFAULT_MODEL,
    };
  }
  static get options() {
    return {
      chunksize: {
        type: "string",
        short: "c",
      },
      batchsize: {
        type: "string",
        short: "b",
      },
      parallel: {
        type: "string",
      },
      model: { type: "string", short: "m" },
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      source: {
        type: "string",
        short: "s",
        default: appConfig.SOURCE_LANGUAGE,
      },
      target: {
        type: "string",
        short: "t",
        default: appConfig.TARGET_LANGUAGE,
      },
      context: { type: "string", short: "i", default: "" },
      url: { type: "string", short: "u" },
      apikey: {
        type: "string",
        short: "k",
        default: appConfig.FALLBACK_VALUES.apiKey,
      },
      wait: { type: "string" },
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
      ...(this.constructor as typeof TranslateCommand).options,
      ...internalOptions,
    };
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: optionsForParser,
      allowPositionals: (this.constructor as typeof TranslateCommand)
        .allowPositionals,
      strict: true,
    });

    const translateHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.tr,
        (this.constructor as typeof TranslateCommand).options,
        {
          ModelParamList: getPresetHelpText(appConfig.PARAM_CONFIGS),
          ...TranslateCommand.helpReplacements,
        },
      );
      log(helpText);
    };

    if (argValues.help) {
      translateHelp();
      return 0;
    }

    if (!positionals[1] || !positionals[2]) {
      exitOne();
      translateHelp();
      throw createError(appState.s.e.lllm.sourceTargetRequired, {
        code: "SOURCE_TARGET_REQUIRED",
      });
    }

    const sourcePath = positionals[1];
    const targetPath = positionals[2];
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

    const useReasoning = !!argValues.reason;
    const activeConfig = resolveModelConfig(paramsKey, useReasoning);

    const llmModelParams = { ...activeConfig.model };

    const promptSettings = activeConfig.prompt || {};
    const defSys = promptSettings.defSys || EMPTY_FIELD;
    const defPrep = promptSettings.defPrep || EMPTY_FIELD;
    const defPrefill = promptSettings.defPrefill || EMPTY_FIELD;

    const sourceLang = argValues.source;
    const targetLang = argValues.target;

    const usePreFlag = defPrep[0];
    const useSystemFlag = defSys[0];
    const roletag = defSys[2] || "system";
    const roletag2 = defPrep[2] || "user";

    let sysPromptFinal: PromptParam = EMPTY_FIELD;
    let prependPromptFinal: PromptParam = EMPTY_FIELD;

    if (useSystemFlag) {
      const sysTemplate = defSys[1];
      const systemContent = buildTranslationInstructions(
        sysTemplate,
        sourceLang,
        targetLang,
      );
      sysPromptFinal = [true, systemContent, roletag, false];
    }

    let contextContent = "";
    if (argValues.context && argValues.context.trim() !== "") {
      contextContent = stripGarbageNewLines(argValues.context.trim()) + "\n\n";
    }

    let finalUserContent;
    if (usePreFlag) {
      const prepTemplate = defPrep[1];
      let processedPrep = buildTranslationInstructions(
        prepTemplate,
        sourceLang,
        targetLang,
      );

      if (processedPrep.includes("{{ .ContextualInformation }}")) {
        processedPrep = simpleTemplate(processedPrep, {
          ContextualInformation: contextContent,
        });
        finalUserContent = processedPrep;
      } else {
        finalUserContent = [processedPrep, contextContent]
          .filter(Boolean)
          .join("\n\n");
      }
    } else {
      finalUserContent = contextContent;
    }

    if (finalUserContent) {
      prependPromptFinal = [true, finalUserContent, roletag2, false];
    }

    let prefillPromptFinal: PromptParam = EMPTY_FIELD;

    if (defPrefill[0]) {
      const prefillTemplate = defPrefill[1];
      const processedPrefill = buildTranslationInstructions(
        prefillTemplate,
        sourceLang,
        targetLang,
      );

      prefillPromptFinal = [true, processedPrefill];
    }

    const hasInstructions =
      (sysPromptFinal[0] && sysPromptFinal[1].trim() !== "") ||
      (prependPromptFinal[0] && prependPromptFinal[1].trim() !== "") ||
      (prefillPromptFinal[0] && prefillPromptFinal[1].trim() !== "");

    if (!hasInstructions) {
      throw createError(appState.s.e.lllm.promptMissing, {
        code: "PROMPT_MISSING",
      });
    }

    const resolveParam = (
      cliValue: string | undefined,
      configValue: number | undefined,
      fallback: string,
    ): number => {
      if (cliValue !== undefined) {
        return +cliValue;
      }
      if (configValue !== undefined) {
        return configValue;
      }
      return +fallback;
    };

    const options: LLMConfigurableProps = {
      ...llmModelParams,

      chunkSize: resolveParam(
        argValues.chunksize,
        llmModelParams.chunkSize,
        appConfig.FALLBACK_VALUES.chunkSize,
      ),
      batchSize: resolveParam(
        argValues.batchsize,
        llmModelParams.batchSize,
        appConfig.FALLBACK_VALUES.batchSize,
      ),
      parallel: resolveParam(
        argValues.parallel,
        llmModelParams.parallel,
        appConfig.FALLBACK_VALUES.parallel,
      ),
      delay: resolveParam(
        argValues.wait ? String(+argValues.wait * 1000) : undefined,
        llmModelParams.delay,
        appConfig.FALLBACK_VALUES.delay,
      ),

      apiKey: argValues.apikey,
      systemPrompt: sysPromptFinal,
      prependPrompt: prependPromptFinal,
      prefill: prefillPromptFinal,
      url: argValues.url || llmModelParams.url || appConfig.FALLBACK_VALUES.url,
      model: argValues.model
        ? [true, argValues.model]
        : llmModelParams.model || appConfig.FALLBACK_VALUES.model,
    };

    const initArgs: [
      LLMConfigurableProps,
      string,
      string,
      ((messages: Message[]) => Promise<string>)?,
    ] = [options, sourcePath, targetPath];
    if (appState.DEBUG_MODE) {
      initArgs.push(dummy);
    }

    try {
      const llm = await LLMBATCHERUI.init(...initArgs);
      appState.activeJob = llm;
      await llm.execute();
    } catch (err) {
      if (isNodeError(err) && err.code === "PROCESSING_ALREADY_COMPLETE") {
        process.exitCode = 0;
        if (isNodeError(err.cause)) {
          log(err.cause.message);
        }
      } else {
        throw err;
      }
    } finally {
      appState.activeJob = null;
    }
    return 0;
  }
}
