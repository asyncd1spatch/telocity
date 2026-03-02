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
  buildImageContent,
  dummy,
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
      Delay: appConfig.FALLBACK_VALUES.delay,
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

    const imageURIs = await buildImageContent(argValues.image);

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

    const useReasoning = !!argValues.reason;
    const activeConfig = resolveModelConfig(paramsKey, useReasoning);

    const llmModelParams = { ...activeConfig.model };

    const promptSettings = activeConfig.prompt || {};
    const defSys = promptSettings.defSys || EMPTY_FIELD;
    const defPrep = promptSettings.defPrep || EMPTY_FIELD;
    const defPrefill = promptSettings.defPrefill || EMPTY_FIELD;

    const roletag = defSys[2] || "system";
    const roletag2 = defPrep[2] || "user";

    let sysPromptFinal: PromptParam = EMPTY_FIELD;
    let prependPromptFinal: PromptParam;

    const useDefaultSystemPrompt = defSys.at(-1);
    const useDefaultPrepPrompt = defPrep.at(-1);

    if (argValues.sysprompt) {
      sysPromptFinal = [
        true,
        stripGarbageNewLines(argValues.sysprompt),
        roletag,
        false,
      ];
    } else if (useDefaultSystemPrompt) {
      sysPromptFinal = [true, defSys[1], roletag, true];
    }

    if (argValues.prompt) {
      prependPromptFinal = [
        true,
        stripGarbageNewLines(argValues.prompt) + "\n\n",
        roletag2,
        false,
      ];
    } else if (useDefaultPrepPrompt) {
      prependPromptFinal = [true, defPrep[1] + "\n\n", roletag2, true];
    } else {
      prependPromptFinal = [
        true,
        appConfig.DEFAULT_TF_PROMPT + "\n\n",
        roletag2,
        false,
      ];
    }

    let prefillPromptFinal: PromptParam = EMPTY_FIELD;

    if (defPrefill[0]) {
      prefillPromptFinal = defPrefill;
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

    const options: LLMConfigurableProps = {
      ...llmModelParams,
      // always override with either hardcoded or CLI values
      // batching is a special case, not the common use case, for this command
      // unlike the translation focused translation command where using
      // a chunked approach makes sense
      // if you need to batch with an arbitrary prompt, pass --chunksize
      // --batchsize and --parallel from the CLI rather tha relying on
      // json presets
      chunkSize: +argValues.chunksize,
      batchSize: +argValues.batchsize,
      parallel: +argValues.parallel,
      delay: argValues.wait
        ? +argValues.wait * 1000
        : (llmModelParams.delay ?? +appConfig.FALLBACK_VALUES.delay),

      apiKey: argValues.apikey,
      systemPrompt: sysPromptFinal,
      prependPrompt: prependPromptFinal,
      prefill: prefillPromptFinal,
      url: argValues.url || llmModelParams.url || appConfig.FALLBACK_VALUES.url,
      model: argValues.model
        ? [true, argValues.model]
        : llmModelParams.model || appConfig.FALLBACK_VALUES.model,
    };

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
