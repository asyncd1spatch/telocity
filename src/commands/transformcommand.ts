import {
  config as appConfig,
  AppStateSingleton,
  createError,
  exitOne,
  generateHelpText,
  log,
  customParseArgs as parseArgs,
  simpleTemplate,
} from "../libs/core/index.ts";
import {
  buildImageContent,
  dummy,
  getPresetHelpText,
  LLMBATCHERUI,
} from "../libs/LLM/index.ts";
import type {
  Command,
  ConfigModelVariant,
  LLMConfigurableProps,
  Message,
  PromptParam,
} from "../libs/types/index.ts";

export default class TransformCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get defaultChunkSize() {
    return "200000";
  }
  static get defaultBatchSize() {
    return "1";
  }
  static get defaultParallel() {
    return "1";
  }
  static get helpReplacements() {
    return {
      ChunkSize: this.defaultChunkSize,
      BatchSize: this.defaultBatchSize,
      Parallel: this.defaultParallel,
      DefaultModel: appConfig.DEFAULT_MODEL,
    };
  }
  static get options() {
    return {
      chunksize: { type: "string", short: "c", default: this.defaultChunkSize },
      batchsize: { type: "string", short: "b", default: this.defaultBatchSize },
      parallel: { type: "string", default: this.defaultParallel },
      model: { type: "string", short: "m" },
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      prompt: { type: "string", short: "i" },
      image: { type: "string", short: "I" },
      sysprompt: { type: "string", short: "s" },
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
      ...(this.constructor as typeof TransformCommand).options,
      ...internalOptions,
    };
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: optionsForParser,
      allowPositionals: (this.constructor as typeof TransformCommand)
        .allowPositionals,
      strict: true,
    });

    const transformHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.tf,
        (this.constructor as typeof TransformCommand).options,
        {
          ModelParamList: getPresetHelpText(appConfig.PARAM_CONFIGS),
          ...TransformCommand.helpReplacements,
        },
      );
      log(helpText);
    };

    if (argValues.help) {
      transformHelp();
      return 0;
    }

    const imageURIs = await buildImageContent(argValues.image as string);

    if (!positionals[1] || !positionals[2]) {
      exitOne();
      transformHelp();
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

    const promptSettings = activeConfig.prompt;
    const roletag = (promptSettings.defSys[2] as string) || "system";
    const roletag2 = (promptSettings.defPrep[2] as string) || "user";

    let sysPromptFinal: PromptParam = appConfig.EMPTY_FIELD;
    let prependPromptFinal: PromptParam = appConfig.EMPTY_FIELD;

    const useDefaultSystemPrompt = promptSettings.defSys?.at(-1);
    const useDefaultPrepPrompt = promptSettings.defPrep?.at(-1);

    if (argValues.sysprompt) {
      sysPromptFinal = [true, argValues.sysprompt, roletag, false];
    } else if (useDefaultSystemPrompt) {
      sysPromptFinal = [true, promptSettings.defSys[1], roletag, true];
    }

    if (argValues.prompt) {
      prependPromptFinal = [true, argValues.prompt + "\n\n", roletag2, false];
    } else if (useDefaultPrepPrompt) {
      prependPromptFinal = [
        true,
        promptSettings.defPrep[1] + "\n\n",
        roletag2,
        true,
      ];
    } else {
      prependPromptFinal = [
        true,
        appConfig.DEFAULT_TF_PROMPT + "\n\n",
        roletag2,
        false,
      ];
    }

    const options: LLMConfigurableProps = {
      ...llmModelParams,
      // always override with either hardcoded or CLI values
      // batching is a special case, not the common use case, for this command
      // unlike the translation focused translation command where using
      // a chunked approach makes sense
      // if you need to batch with an arbitrary prompt, pass --chunksize
      // --batchsize and --parallel from the CLI rather tha relying on
      // json presets
      chunkSize: Number(argValues.chunksize),
      batchSize: Number(argValues.batchsize),
      parallel: Number(argValues.parallel),

      apiKey: argValues.apikey,
      systemPrompt: sysPromptFinal,
      prependPrompt: prependPromptFinal,
      url: argValues.url || llmModelParams.url || appConfig.FALLBACK_VALUES.url,
      model: argValues.model ? [true, argValues.model] : llmModelParams.model,
    };
    if (argValues.wait) {
      options.delay = [false, Number(argValues.wait)];
    }

    if (Array.isArray(imageURIs) && imageURIs.length > 0) {
      options.images = imageURIs;
    }

    const initArgs: [
      LLMConfigurableProps,
      string,
      string,
      ((messages: Message[]) => Promise<string>)?,
    ] = [options, sourcePath, targetPath];
    if (appState.DEBUG_MODE) {
      initArgs.push(dummy);
    }

    const llm = await LLMBATCHERUI.init(...initArgs);
    await llm.execute();
    return 0;
  }
}
