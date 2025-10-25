import {
  AppStateSingleton,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  exitOne,
  generateHelpText,
  log,
  simpleTemplate,
} from "../libs/core";
import {
  buildSystemTranslationInstruction,
  buildUserTranslationTask,
  dummy,
  getPresetHelpText,
  UILLMIO,
} from "../libs/LLM";
import type { Command, ConfigModelVariant, LLMConfigurableProps, Message, PromptParam } from "../libs/types";

export default class TranslateCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return {
      ChunkSize: appConfig.FALLBACK_VALUES.chunkSize,
      BatchSize: appConfig.FALLBACK_VALUES.batchSize,
      SourceLanguage: appConfig.SOURCE_LANGUAGE,
      TargetLanguage: appConfig.TARGET_LANGUAGE,
      DefaultModel: appConfig.DEFAULT_MODEL,
    };
  }
  static get options() {
    return {
      chunksize: { type: "string", short: "c", default: appConfig.FALLBACK_VALUES.chunkSize },
      batchsize: { type: "string", short: "b", default: appConfig.FALLBACK_VALUES.batchSize },
      model: { type: "string", short: "m" },
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      source: { type: "string", short: "s", default: appConfig.SOURCE_LANGUAGE },
      target: { type: "string", short: "t", default: appConfig.TARGET_LANGUAGE },
      context: { type: "string", short: "i", default: "" },
      url: { type: "string", short: "u" },
      apikey: { type: "string", short: "k", default: appConfig.FALLBACK_VALUES.apiKey },
      wait: { type: "string", short: "w" },
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
      allowPositionals: (this.constructor as typeof TranslateCommand).allowPositionals,
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
    const sourceLang = argValues.source;
    const targetLang = argValues.target;

    const usePreFlag = promptSettings.defPrep[0];
    const useSystemFlag = promptSettings.defSys[0];
    const roletag = (promptSettings.defSys[2] as string) || "system";
    const roletag2 = (promptSettings.defPrep[2] as string) || "user";

    let sysPromptFinal: PromptParam = appConfig.EMPTY_FIELD;
    let prependPromptFinal: PromptParam = appConfig.EMPTY_FIELD;

    if (useSystemFlag) {
      const sysTemplate = promptSettings.defSys[1];
      const systemContent = buildSystemTranslationInstruction(sysTemplate, sourceLang, targetLang);
      sysPromptFinal = [true, systemContent, roletag, false];
    }

    const userContentParts: string[] = [];
    if (usePreFlag) {
      const prepTemplate = promptSettings.defPrep[1];
      const processedPrep = buildSystemTranslationInstruction(prepTemplate, sourceLang, targetLang);
      userContentParts.push(processedPrep);
    }
    userContentParts.push(buildUserTranslationTask(argValues.context, sourceLang, targetLang));

    const finalUserContent = userContentParts.join("\n\n").trim();
    if (finalUserContent) {
      prependPromptFinal = [true, finalUserContent, roletag2, false];
    }

    const llmModelParams = { ...activeConfig.model };
    const options: LLMConfigurableProps = {
      chunkSize: Number(argValues.chunksize),
      batchSize: Number(argValues.batchsize),
      apiKey: argValues.apikey,
      systemPrompt: sysPromptFinal,
      prependPrompt: prependPromptFinal,
      ...llmModelParams,
      url: argValues.url || llmModelParams.url || appConfig.FALLBACK_VALUES.url,
      model: argValues.model ? [true, argValues.model] : llmModelParams.model,
    };
    if (argValues.wait) {
      options.delay = [false, Number(argValues.wait)];
    }

    const initArgs: [LLMConfigurableProps, string, string, ((messages: Message[]) => Promise<string>)?] = [
      options,
      sourcePath,
      targetPath,
    ];
    if (appState.DEBUG_MODE) {
      initArgs.push(dummy);
    }

    const llm = await UILLMIO.init(...initArgs);
    await llm.execute();
    return 0;
  }
}
