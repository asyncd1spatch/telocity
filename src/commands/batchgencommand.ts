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
  getPresetHelpText,
  segmentText,
  stripGarbageNewLines,
} from "../libs/LLM";
import type { Command, ConfigModelVariant, Message } from "../libs/types";

function createOpenAILine(custom_id: string, model: string, messages: Message[], temperature?: number): string {
  const body: { model: string; messages: Message[]; temperature?: number } = {
    model,
    messages,
  };

  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const payload = {
    custom_id,
    method: "POST",
    url: "/v1/chat/completions",
    body,
  };
  return JSON.stringify(payload);
}

function createGeminiLine(key: string, content: string, temperature?: number): string {
  const request: { contents: { parts: { text: string }[] }[]; generation_config?: { temperature: number } } = {
    contents: [{ parts: [{ text: content }] }],
  };
  if (temperature !== undefined) {
    request.generation_config = { temperature };
  }

  const payload = {
    key,
    request,
  };
  return JSON.stringify(payload);
}

export default class BatchGenCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return {
      ChunkSize: appConfig.FALLBACK_VALUES.chunkSize,
      DefaultModel: appConfig.DEFAULT_MODEL,
    };
  }
  static get options() {
    return {
      format: { type: "string", short: "f", default: "openai" },
      chunksize: { type: "string", short: "c", default: appConfig.FALLBACK_VALUES.chunkSize },
      model: { type: "string", short: "m" },
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      source: { type: "string", short: "s", default: appConfig.SOURCE_LANGUAGE },
      target: { type: "string", short: "t", default: appConfig.TARGET_LANGUAGE },
      context: { type: "string", short: "i", default: "" },
      reason: { type: "boolean", short: "r" },
      help: { type: "boolean", short: "h" },
    } as const;
  }

  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const optionsForParser = (this.constructor as typeof BatchGenCommand).options;
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: optionsForParser,
      allowPositionals: (this.constructor as typeof BatchGenCommand).allowPositionals,
      strict: true,
    });

    const batchgenhelptext = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.bg,
        (this.constructor as typeof BatchGenCommand).options,
        {
          ModelParamList: getPresetHelpText(appConfig.PARAM_CONFIGS),
          ...BatchGenCommand.helpReplacements,
          P_NAME: appState.P_NAME,
        },
      );
      log(helpText);
    };

    if (argValues.help) {
      batchgenhelptext();
      return 0;
    }

    const format = argValues.format.toLowerCase();

    if (!positionals[1] || !positionals[2]) {
      batchgenhelptext();
      exitOne();
      throw createError(appState.s.e.lllm.sourceTargetRequired, {
        code: "SOURCE_TARGET_REQUIRED",
      });
    }

    const sourcePath = positionals[1];
    const targetPath = positionals[2];

    if (!(await Bun.file(sourcePath).exists())) {
      throw createError(simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: sourcePath }), { code: "ENOENT" });
    }

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
    const roleTag = (promptSettings.defSys[2] as string) || "system";
    const roleTag2 = (promptSettings.defPrep[2] as string) || "user";

    let systemContent: string | null = null;
    if (useSystemFlag) {
      const sysTemplate = promptSettings.defSys[1];
      systemContent = buildSystemTranslationInstruction(sysTemplate, sourceLang, targetLang);
    }

    const userContentParts: string[] = [];
    if (usePreFlag) {
      const prepTemplate = promptSettings.defPrep[1];
      const processedPrep = buildSystemTranslationInstruction(prepTemplate, sourceLang, targetLang);
      userContentParts.push(processedPrep);
    }
    userContentParts.push(buildUserTranslationTask(argValues.context, sourceLang, targetLang));
    const finalUserContentTemplate = userContentParts.join("\n\n").trim();

    const modelName = argValues.model || (activeConfig.model.model?.[0]
      ? activeConfig.model.model[1]
      : appConfig.DEFAULT_MODEL);

    const temperatureTuple = activeConfig.model.temperature;
    const temperature = (temperatureTuple?.[0]) ? temperatureTuple[1] : undefined;

    const sourceText = await Bun.file(sourcePath).text();
    const normalizedText = stripGarbageNewLines(sourceText);
    const chunkSize = Number(argValues.chunksize);
    const textChunks = segmentText(normalizedText, chunkSize).filter(chunk => chunk.trim() !== "");

    if (textChunks.length === 0) {
      log(appState.s.m.lllm.sourceEmpty);
      return 0;
    }
    const target = Bun.file(targetPath);
    if (await target.exists()) {
      throw createError(simpleTemplate(appState.s.e.lllm.targetFileExists, { TargetPath: targetPath }));
    }
    const writer = target.writer();
    log(simpleTemplate(appState.s.m.lllm.generatingRequests, { Count: textChunks.length }));

    try {
      for (const [index, chunk] of textChunks.entries()) {
        const requestId = `request-${index + 1}`;
        const fullUserContent = `${finalUserContentTemplate}\n\n${chunk}`;
        let jsonlLine: string;

        switch (format) {
          case "openai": {
            const messages: Message[] = [];
            if (systemContent) {
              messages.push({ role: roleTag, content: systemContent });
            }
            messages.push({ role: roleTag2, content: fullUserContent });
            jsonlLine = createOpenAILine(requestId, modelName, messages, temperature);
            break;
          }
          case "gemini": {
            const combinedContent = systemContent
              ? `${systemContent}\n\n${fullUserContent}`
              : fullUserContent;
            jsonlLine = createGeminiLine(requestId, combinedContent, temperature);
            break;
          }
          default:
            throw createError(
              simpleTemplate(appState.s.e.lllm.invalidFormat, { Format: argValues.format }),
              { code: "INVALID_FORMAT" },
            );
        }
        writer.write(jsonlLine + "\n");
      }
      await writer.end();
      log(simpleTemplate(appState.s.m.lllm.wroteEntries, { Count: textChunks.length, TargetPath: targetPath }));
    } catch (err) {
      await Bun.file(targetPath).delete().catch(() => {});
      throw createError(appState.s.e.lllm.jsonlGenError, { cause: err });
    }

    return 0;
  }
}
