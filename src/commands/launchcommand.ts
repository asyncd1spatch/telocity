import { join } from "node:path";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  errlog,
  generateHelpText,
  isNodeError,
  log,
  red,
  simpleTemplate,
} from "../libs/core";
import { getLaunchableModels } from "../libs/LLM";
import type { Command, ConfigQuantFile, ConfigQuantizationLevels } from "../libs/types";

function normalizeArgs(raw: unknown): string[] {
  if (raw === null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map(String).map(s => s.trim()).filter(Boolean);
}

export default class LaunchCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "none" as const;
  }
  static get options() {
    return {
      reason: { type: "boolean", short: "r" },
      quant: { type: "string", short: "q" },
      multimodal: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof LaunchCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof LaunchCommand).options,
    });

    if (argValues.help) {
      const replacements = {
        LaunchableModelList: getLaunchableModels(appConfig.PARAM_CONFIGS),
      };
      const helpText = generateHelpText(
        appState.s.help.commands.lu,
        (this.constructor as typeof LaunchCommand).options,
        replacements,
      );
      log(helpText);
      return 0;
    }

    const modelKey = positionals[1] ?? appConfig.DEFAULT_MODEL;
    const modelConfig = appConfig.PARAM_CONFIGS[modelKey];

    if (!modelConfig) {
      throw createError(simpleTemplate(appState.s.e.lllm.undefinedParam, { ParamKey: modelKey }), {
        code: "UNDEFINED_PARAM",
      });
    }

    const useReasoning = !!argValues.reason;

    let modelTypeConfigs: ConfigQuantizationLevels | undefined;
    switch (modelConfig.reasoningType) {
      case "reason_and_instruct":
        modelTypeConfigs = modelConfig.quantFiles?.[useReasoning ? "reasoning" : "instruct"];
        break;
      case "instruct_only":
        modelTypeConfigs = modelConfig.quantFiles;
        if (useReasoning) {
          log(simpleTemplate(appState.s.e.lllm.reasoningNotSupported, { Model: modelKey }));
        }
        break;
      case "reason_only":
        modelTypeConfigs = modelConfig.quantFiles;
        break;
      default:
        throw createError(
          simpleTemplate(appState.s.e.lllm.invalidReasoningType, {
            Model: modelKey,
            Type: String(modelConfig),
          }),
          { code: "INVALID_REASONING_TYPE" },
        );
    }

    if (!modelConfig.quantFiles || !appConfig.QUANTIZATION_ORDER) {
      throw createError(
        simpleTemplate(appState.s.e.c.lu.undefinedLauncher, { ModelPreset: modelKey }),
        { code: "NOT_LAUNCHABLE" },
      );
    }

    if (!modelTypeConfigs) {
      throw createError(
        simpleTemplate(appState.s.e.c.lu.undefinedModelType, {
          ModelType: modelConfig.reasoningType,
          ModelPreset: modelKey,
        }),
        { code: "MODEL_TYPE_NOT_FOUND" },
      );
    }

    let selectedQuant: ConfigQuantFile | null = null;
    let foundQuantKey: string | null = null;
    const specifiedQuant = argValues.quant;

    if (specifiedQuant) {
      const quantConfig = modelTypeConfigs[specifiedQuant];
      if (!quantConfig) {
        throw createError(
          simpleTemplate(appState.s.e.c.lu.undefinedQuant, {
            QuantReq: specifiedQuant,
            ModelPreset: modelKey,
            AvailableQuants: Object.keys(modelTypeConfigs).join(", "),
          }),
          { code: "INVALID_QUANT" },
        );
      }
      const filePath = join(appConfig.MODELS_LOCATION, quantConfig.file);
      if (!(await Bun.file(filePath).exists())) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: filePath }),
          { code: "QUANT_FILE_NOT_FOUND" },
        );
      }
      selectedQuant = quantConfig;
      foundQuantKey = specifiedQuant;
    } else {
      for (const quant of appConfig.QUANTIZATION_ORDER) {
        const quantConfig = modelTypeConfigs[quant];
        if (quantConfig) {
          const filePath = join(appConfig.MODELS_LOCATION, quantConfig.file);
          if (await Bun.file(filePath).exists()) {
            selectedQuant = quantConfig;
            foundQuantKey = quant;
            break;
          }
        }
      }
    }

    if (!selectedQuant || !foundQuantKey) {
      throw createError(
        simpleTemplate(appState.s.e.c.lu.noModelFiles, {
          ModelPreset: modelKey,
          ModelType: modelConfig.reasoningType,
          QuantList: appConfig.QUANTIZATION_ORDER.join(", "),
        }),
        { code: "NO_QUANT_FILES" },
      );
    }

    const modelFilePath = join(appConfig.MODELS_LOCATION, selectedQuant.file);
    const mmprojPath = selectedQuant.fileMMPROJ
      ? join(appConfig.MODELS_LOCATION, selectedQuant.fileMMPROJ)
      : undefined;

    log(
      simpleTemplate(appState.s.m.c.lu.preparingLaunch, {
        ModelPreset: modelKey,
        ModelType: modelConfig.reasoningType,
        QuantReq: foundQuantKey,
      }),
    );
    log(simpleTemplate(appState.s.m.c.lu.found, { String: modelFilePath }));

    const commandArgs: string[] = [...normalizeArgs(appConfig.LLAMACPP_BASE_ARGS)];
    commandArgs.push("-m", modelFilePath);

    const useMultimodal = !!argValues.multimodal;

    if (useMultimodal) {
      if (!mmprojPath) {
        throw createError(
          simpleTemplate(appState.s.e.c.lu.mmprojNotConfigured, { ModelPreset: modelKey }),
          { code: "MMPROJ_NOT_CONFIGURED" },
        );
      }
      if (!(await Bun.file(mmprojPath).exists())) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: mmprojPath }),
          { code: "MMPROJ_FILE_NOT_FOUND" },
        );
      }
      commandArgs.push("--mmproj", mmprojPath);
      log(simpleTemplate(appState.s.m.c.lu.found, { String: `MMPROJ: ${mmprojPath}` }));
    }

    commandArgs.push(...normalizeArgs(selectedQuant.args));

    const fullCommandArray = [appConfig.LLAMACPP_CMD, ...commandArgs];
    log(
      simpleTemplate(appState.s.m.c.lu.executingCommand, {
        String: fullCommandArray.join(" "),
      }),
    );

    try {
      const subprocess = Bun.spawn(fullCommandArray);
      const code = await subprocess.exited;

      if (code !== 0 && code !== null) {
        errlog(simpleTemplate(appState.s.m.c.lu.llamaServerExit, { ExitCode: code }));
      }
      return code ?? 0;
    } catch (err) {
      if (isNodeError(err)) {
        createError(red(simpleTemplate(appState.s.e.c.lu.failedToStart, { Error: err.message })), {
          code: "FAILED_START",
        });
      }
      return 1;
    }
  }
}
