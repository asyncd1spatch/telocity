import { createWriteStream } from "node:fs";
import { open, readFile, unlink } from "node:fs/promises";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  exitOne,
  generateHelpText,
  isEexistError,
  isEnoentError,
  isNodeError,
  log,
  customParseArgs as parseArgs,
  simpleTemplate,
} from "../libs/core/index.ts";
import {
  buildTranslationInstructions,
  getDefaultModelParam,
  getPresetHelpText,
  segmentText,
  stripGarbageNewLines,
} from "../libs/LLM/index.ts";
import type {
  Command,
  ConfigModelVariant,
  Message,
  ResponsesMessage,
} from "../libs/types/index.ts";
import { EMPTY_FIELD } from "../libs/types/index.ts";

function createMistralLine(
  custom_id: string,
  messages: Message[],
  temperature?: number,
): string {
  const body: {
    messages: Message[];
    temperature?: number;
  } = {
    messages,
  };

  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const payload = {
    custom_id,
    body,
  };
  return JSON.stringify(payload);
}

function createGeminiLine(
  key: string,
  content: string,
  temperature?: number,
): string {
  const request: {
    contents: { parts: { text: string }[] }[];
    generation_config?: { temperature: number };
  } = {
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

function createChatCompletionsLine(
  custom_id: string,
  model: string,
  messages: Message[],
  temperature?: number,
): string {
  const body: {
    model: string;
    messages: Message[];
    temperature?: number;
  } = {
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

function createResponsesLine(
  custom_id: string,
  model: string,
  messages: Message[],
  temperature?: number,
): string {
  let instructions: string | undefined;
  const userInputMessages: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "system" && typeof msg.content === "string") {
      instructions = (instructions ? instructions + "\n" : "") + msg.content;
    } else {
      userInputMessages.push(msg);
    }
  }

  const transformedInput: ResponsesMessage[] = userInputMessages.map((msg) => ({
    type: "message",
    role: msg.role,
    content: [
      {
        type: msg.role === "assistant" ? "output_text" : "input_text",
        text: msg.content as string,
      },
    ],
  }));

  const body: {
    model: string;
    input: ResponsesMessage[];
    instructions?: string;
    temperature?: number;
  } = {
    model,
    input: transformedInput,
  };

  if (instructions) {
    body.instructions = instructions;
  }
  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const payload = {
    custom_id,
    method: "POST",
    url: "/v1/responses",
    body,
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
      ChunkSize: getDefaultModelParam("chunkSize"),
      DefaultModel: appConfig.DEFAULT_MODEL,
      FormatsList: BatchGenCommand.availableFormats,
    };
  }
  static get options() {
    return {
      format: { type: "string", short: "f", default: "mistral" },
      chunksize: {
        type: "string",
        short: "c",
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
      reason: { type: "boolean", short: "r" },
      help: { type: "boolean", short: "h" },
    } as const;
  }

  static get BACKENDS(): Readonly<{
    readonly [key: string]: {
      readonly display: string;
      readonly makeLine: (
        requestId: string,
        opts: {
          model?: string;
          messages?: Message[];
          content?: string;
          temperature?: number;
        },
      ) => string;
    };
  }> {
    return {
      mistral: {
        display: "Mistral batch",
        makeLine: (requestId, opts) =>
          createMistralLine(requestId, opts.messages ?? [], opts.temperature),
      },
      gemini: {
        display: "Gemini",
        makeLine: (requestId, opts) =>
          createGeminiLine(requestId, opts.content ?? "", opts.temperature),
      },
      "openai-chatcompletions": {
        display: "OpenAI Chat Completions (/v1/chat/completions)",
        makeLine: (requestId, opts) =>
          createChatCompletionsLine(
            requestId,
            opts.model ?? appConfig.DEFAULT_MODEL,
            opts.messages ?? [],
            opts.temperature,
          ),
      },
      "openai-responses": {
        display: "OpenAI Responses (/v1/responses)",
        makeLine: (requestId, opts) =>
          createResponsesLine(
            requestId,
            opts.model ?? appConfig.DEFAULT_MODEL,
            opts.messages ?? [],
            opts.temperature,
          ),
      },
    } as const;
  }

  private static get availableFormats() {
    return Object.keys(BatchGenCommand.BACKENDS).join(", ");
  }

  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const optionsForParser = (this.constructor as typeof BatchGenCommand)
      .options;
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: optionsForParser,
      allowPositionals: (this.constructor as typeof BatchGenCommand)
        .allowPositionals,
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

    const backend = (
      BatchGenCommand.BACKENDS as {
        [key: string]: {
          display: string;
          makeLine: (
            requestId: string,
            opts: {
              model?: string;
              messages?: Message[];
              content?: string;
              temperature?: number;
            },
          ) => string;
        };
      }
    )[format];
    if (!backend) {
      throw createError(
        simpleTemplate(appState.s.e.lllm.invalidFormat, {
          Format: argValues.format,
          Available: BatchGenCommand.availableFormats,
        }),
        { code: "INVALID_FORMAT" },
      );
    }

    const promptSettings = activeConfig.prompt || {};
    const defSys = promptSettings.defSys || EMPTY_FIELD;
    const defPrep = promptSettings.defPrep || EMPTY_FIELD;
    const sourceLang = argValues.source;
    const targetLang = argValues.target;

    const usePreFlag = defPrep[0];
    const useSystemFlag = defSys[0];
    const roleTag = defSys[2] || "system";
    const roleTag2 = defPrep[2] || "user";

    let systemContent: string | null = null;
    if (useSystemFlag) {
      const sysTemplate = defSys[1];
      systemContent = buildTranslationInstructions(
        sysTemplate,
        sourceLang,
        targetLang,
      );
    }

    let contextContent = "";
    if (argValues.context && argValues.context.trim() !== "") {
      contextContent = stripGarbageNewLines(argValues.context.trim()) + "\n\n";
    }

    let finalUserContentTemplate;
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
        finalUserContentTemplate = processedPrep;
      } else {
        finalUserContentTemplate = [processedPrep, contextContent]
          .filter(Boolean)
          .join("\n\n");
      }
    } else {
      finalUserContentTemplate = contextContent;
    }

    const hasInstructions =
      (systemContent && systemContent.trim() !== "") ||
      (finalUserContentTemplate && finalUserContentTemplate.trim() !== "");

    if (!hasInstructions) {
      throw createError(appState.s.e.lllm.promptMissing, {
        code: "PROMPT_MISSING",
      });
    }

    const modelName =
      argValues.model ||
      (activeConfig.model.model?.[0]
        ? activeConfig.model.model[1]
        : appConfig.FALLBACK_VALUES.model[1]);

    const temperatureTuple = activeConfig.model.temperature;
    const temperature = temperatureTuple?.[0] ? temperatureTuple[1] : undefined;

    let sourceText: string;
    try {
      sourceText = await readFile(sourcePath, "utf-8");
    } catch (err) {
      if (isEnoentError(err)) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.fileNotFound, {
            FilePath: sourcePath,
          }),
          { code: "ENOENT", cause: err },
        );
      }
      throw err;
    }

    const normalizedText = stripGarbageNewLines(sourceText);

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

    const chunkSize = resolveParam(
      argValues.chunksize,
      activeConfig.model.chunkSize,
      appConfig.FALLBACK_VALUES.chunkSize,
    );

    const textChunks = segmentText(normalizedText, chunkSize).filter(
      (chunk) => chunk.trim() !== "",
    );

    if (textChunks.length === 0) {
      log(appState.s.m.lllm.sourceEmpty);
      return 0;
    }

    let writer;
    try {
      const handle = await open(targetPath, "wx");
      writer = createWriteStream("", {
        fd: handle.fd,
        encoding: "utf-8",
        autoClose: true,
      });
    } catch (err) {
      if (isEexistError(err)) {
        throw createError(
          simpleTemplate(appState.s.e.lllm.targetFileExists, {
            TargetPath: targetPath,
          }),
          { code: "TARGET_EXISTS", cause: err },
        );
      }
      throw err;
    }

    log(
      simpleTemplate(appState.s.m.lllm.generatingRequests, {
        Count: textChunks.length,
      }),
    );

    try {
      const streamFinished = new Promise<void>((resolve, reject) => {
        writer.once("finish", () => resolve());
        writer.once("error", (err: unknown) => {
          if (isEexistError(err)) {
            reject(
              createError(
                simpleTemplate(appState.s.e.lllm.targetFileExists, {
                  TargetPath: targetPath,
                }),
                { code: "TARGET_EXISTS", cause: err },
              ),
            );
            return;
          }

          if (err instanceof Error) {
            reject(err);
          } else {
            reject(new Error(String(err)));
          }
        });
      });

      for (const [index, chunk] of textChunks.entries()) {
        const requestId = `request-${index + 1}`;
        let fullUserContent: string;

        if (finalUserContentTemplate.includes("{{ .TextToInject }}")) {
          fullUserContent = simpleTemplate(finalUserContentTemplate, {
            TextToInject: chunk,
          });
        } else {
          fullUserContent = `${finalUserContentTemplate}\n\n${chunk}`;
        }

        const messages: Message[] = [];
        if (systemContent) {
          messages.push({ role: roleTag, content: systemContent });
        }
        messages.push({ role: roleTag2, content: fullUserContent });

        const combinedContent = systemContent
          ? `${systemContent}\n\n${fullUserContent}`
          : fullUserContent;

        const jsonlLine = backend.makeLine(requestId, {
          model: modelName,
          messages,
          content: combinedContent,
          temperature,
        });

        writer.write(jsonlLine + "\n");
      }

      writer.end();
      await streamFinished;

      log(
        simpleTemplate(appState.s.m.lllm.wroteEntries, {
          Count: textChunks.length,
          TargetPath: targetPath,
        }),
      );
    } catch (err) {
      try {
        writer.destroy();
      } catch {
        // ignore
      }
      if (!isEexistError(err)) {
        await unlink(targetPath).catch(() => {});
      }
      if (isNodeError(err) && err.code === "TARGET_EXISTS") {
        throw err;
      }
      throw createError(appState.s.e.lllm.jsonlGenError, { cause: err });
    }

    return 0;
  }
}
