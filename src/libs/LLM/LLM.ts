import {
  config as appConfig,
  AppStateSingleton,
  createError,
  isNodeError,
  isTypeError,
  simpleTemplate,
  StreamedLineWrapper,
  V,
} from "../core/index.ts";
import type {
  AppState,
  backend,
  ConfigParam,
  ConfigurablePropValue,
  DelayTuple,
  ImageContentPart,
  LLMConfigurableProps,
  MappableParamKey,
  MappableParamValue,
  Message,
  NumberParam,
  OpenAIPayload,
  OpenAIStreamChunk,
  PromptParam,
  StringParam,
  TextContentPart,
} from "../types/index.ts";

type ConfigurableKey = keyof LLMConfigurableProps;
type ValidatorFn<T> = (value: unknown) => asserts value is T;
interface BaseConfigEntry<T> {
  prop: ConfigurableKey;
  getValue?: (value: unknown) => T;
  validate: ValidatorFn<T>;
  storeTransformedValue?: boolean;
}
interface CustomHandlerEntry {
  customHandler: (instance: LLM, optionValue: unknown) => void;
}
type ConfigEntry<T> = BaseConfigEntry<T> | CustomHandlerEntry;
let _ARG_CONFIG: {
  [K in ConfigurableKey]?: ConfigEntry<LLMConfigurableProps[K]>;
};

function getArgConfig() {
  if (_ARG_CONFIG) {
    return _ARG_CONFIG;
  }
  const appState = AppStateSingleton.getInstance();

  const validateImageArray = (val: unknown): asserts val is string[] => {
    if (!Array.isArray(val)) {
      throw createError(
        simpleTemplate(appState.s.e.v.invalidImageArray, {
          Value: String(val),
        }),
        { code: "INVALID_TYPE" },
      );
    }
    for (const item of val) {
      if (typeof item !== "string" || !item.startsWith("data:")) {
        const truncated =
          typeof item === "string"
            ? `${item.substring(0, 70)}...`
            : String(item);
        throw createError(
          simpleTemplate(appState.s.e.v.invalidDataURI, { Value: truncated }),
          {
            code: "INVALID_DATA_URI",
          },
        );
      }
    }
  };

  _ARG_CONFIG = {
    llmbackend: {
      prop: "llmbackend",
      validate: V.str(
        { notEmpty: true },
        appState.s.e.v.invalidText,
        "INVALID_TEXT",
        " {{ .Text }}",
      ),
    },
    url: {
      prop: "url",
      validate: V.str(
        { notEmpty: true },
        appState.s.e.v.invalidURL,
        "INVALID_URL",
        "{{ .URL }}",
        { fn: (v) => v.startsWith("http://") || v.startsWith("https://") },
        appState.s.e.v.invalidURLScheme,
        "INVALID_URL_SCHEME",
        "{{ .URL }}",
      ),
    },
    apiKey: {
      prop: "apiKey",
      validate: V.str(
        {},
        appState.s.e.v.invalidAPIKey,
        "INVALID_API_KEY",
        "{{ .APIKey }}",
      ),
    },
    images: {
      prop: "images",
      validate: validateImageArray,
    },
    delay: {
      prop: "delay",
      getValue: V.getDelaySeconds(
        appState.s.e.v.invalidDelayValue,
        "INVALID_DELAY",
      ),
      validate: V.delay(
        { min: 0 },
        appState.s.e.v.invalidDelayValue,
        "INVALID_DELAY_VALUE",
      ),
      storeTransformedValue: true,
    },
    model: {
      prop: "model",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str(
        {},
        appState.s.e.v.invalidModel,
        "INVALID_MODEL",
        "{{ .Model }}",
      ),
    },
    temperature: {
      prop: "temperature",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.num(
        { min: 0, max: 2, allowNaN: false },
        appState.s.e.v.invalidTemperatureRange,
        "INVALID_TEMPERATURE_RANGE",
      ),
    },
    top_p: {
      prop: "top_p",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.num(
        { min: 0, max: 1, allowNaN: false },
        appState.s.e.v.invalidTopPRange,
        "INVALID_TOP_P_RANGE",
      ),
    },
    top_k: {
      prop: "top_k",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.num(
        { min: 0, max: 1000, integer: true, allowNaN: false },
        appState.s.e.v.invalidTopKRange,
        "INVALID_TOP_K_RANGE",
      ),
    },
    presence_penalty: {
      prop: "presence_penalty",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.num(
        { min: -2, max: 2, allowNaN: false },
        appState.s.e.v.invalidPenaltyRange,
        "INVALID_PENALTY_RANGE",
      ),
    },
    seed: {
      prop: "seed",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.num(
        { min: 1, integer: true, allowNaN: false },
        appState.s.e.v.seedMustBePositiveInteger,
        "INVALID_SEED",
      ),
    },
    systemPrompt: {
      prop: "systemPrompt",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str({}, appState.s.e.v.invalidPrompt, "INVALID_PROMPT"),
    },
    prependPrompt: {
      prop: "prependPrompt",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str({}, appState.s.e.v.invalidPrompt, "INVALID_PROMPT"),
    },
    chat_template_kwargs: {
      prop: "chat_template_kwargs",
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidKwargs,
        "INVALID_KWARGS",
      ),
      validate: (val: unknown) => {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          throw createError(appState.s.e.v.invalidKwargsType, {
            code: "INVALID_KWARGS_TYPE",
          });
        }
      },
    },
  };
  return _ARG_CONFIG;
}

let _OPT_PARAMS: readonly MappableParamKey[];
export function getOptParams(): readonly MappableParamKey[] {
  if (_OPT_PARAMS) {
    return _OPT_PARAMS;
  }

  _OPT_PARAMS = [
    "model",
    "temperature",
    "top_p",
    "top_k",
    "presence_penalty",
    "seed",
    "chat_template_kwargs",
  ] as const;

  return _OPT_PARAMS;
}

export class LLM {
  public static readonly TerminationState = Object.freeze({
    NONE: "none",
    REQUESTED: "requested",
    FORCEFUL: "forceful",
  } as const);

  protected readonly llmbackend: backend = "chatcompletions";
  protected readonly url: string = "https://localhost:6666/";
  protected readonly apiKey: string = "";
  protected readonly delay?: DelayTuple;
  protected readonly model?: StringParam;
  protected readonly temperature?: NumberParam;
  protected readonly top_p?: NumberParam;
  protected readonly top_k?: NumberParam;
  protected readonly presence_penalty?: NumberParam;
  protected readonly seed?: NumberParam;
  protected readonly chat_template_kwargs?: ConfigParam<Record<string, string>>;
  protected readonly systemPrompt?: PromptParam;
  protected readonly prependPrompt?: PromptParam;
  protected readonly images?: string[];
  protected readonly batchSize: number = 1;
  protected readonly parallel: number = 1;
  protected readonly chunkSize: number = 1;
  protected readonly abrtTimeout;
  protected readonly appState: AppState;
  public completion: (
    messages: Message[],
    options?: { verbose?: boolean | ((chunk: string) => void) },
  ) => Promise<string>;

  constructor(
    options: LLMConfigurableProps,
    llmcall?: (
      messages: Message[],
      options?: { verbose?: boolean | ((chunk: string) => void) },
    ) => Promise<string>,
  ) {
    this.appState = AppStateSingleton.getInstance();
    this.abrtTimeout = appConfig.HUMAN_TIMEOUT * 60000;
    const propsToAssign: Partial<LLMConfigurableProps> = {};

    const optionKeys = Object.keys(options) as Array<
      keyof LLMConfigurableProps
    >;

    const ARG_CONFIG = getArgConfig();
    for (const key of optionKeys) {
      const optionValue = options[key];
      const configEntry = ARG_CONFIG[key];
      if (configEntry) {
        if ("customHandler" in configEntry && configEntry.customHandler) {
          configEntry.customHandler(this, optionValue);
        } else if ("prop" in configEntry) {
          const valueToValidate = configEntry.getValue
            ? configEntry.getValue(optionValue)
            : optionValue;
          configEntry.validate(valueToValidate);
          const prop = configEntry.prop;

          const valueToStore = configEntry.storeTransformedValue
            ? valueToValidate
            : optionValue;

          (propsToAssign as Record<ConfigurableKey, ConfigurablePropValue>)[
            prop
          ] = valueToStore;
        }
      }
    }
    Object.assign(this, propsToAssign);

    let tmpcall;
    switch (this.llmbackend) {
      case "chatcompletions":
      default:
        tmpcall = this.chatCompletions.bind(this);
        break;
    }
    this.completion = llmcall || tmpcall;
    if (this.delay === undefined) {
      this.delay = [true, 60000];
    }
  }

  protected async *chatCompletionsStream(
    messages: Message[],
    { idleTimeout = false } = {},
  ): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let response: Response | null = null;

    const startTimeout = (reason: string | Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        controller.abort(reason);
      }, this.abrtTimeout);
    };

    startTimeout(
      idleTimeout
        ? this.appState.s.e.lllm.idleTimeOut
        : this.appState.s.e.lllm.hardTimeOut,
    );

    const payload: OpenAIPayload = { messages, stream: true };
    const OPT_PARAMS = getOptParams();
    for (const k of OPT_PARAMS) {
      const prop = this[k];
      if (Array.isArray(prop) && prop[0]) {
        (payload as Record<MappableParamKey, MappableParamValue>)[k] = prop[1];
      }
    }

    try {
      try {
        response = await fetch(this.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": `${this.appState.P_NAME}/${this.appState.P_VERSION}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = this.appState.s.e.lllm.unknownOpenAIError;
          try {
            const errorJson = JSON.parse(errorBody) as {
              error?: { message?: string };
            };

            errorMessage = errorJson?.error?.message || errorBody;
          } catch {
            errorMessage = errorBody;
          }
          throw createError(
            simpleTemplate(this.appState.s.e.lllm.openaiApiError, {
              Status: response.status.toString(),
              Message: errorMessage,
            }),
            { code: "LLM_API_ERROR" },
          );
        }
      } catch (err) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (controller.signal.aborted) {
          const reason: unknown = controller.signal.reason;
          const message =
            reason instanceof Error ? reason.message : String(reason);
          throw createError(
            simpleTemplate(this.appState.s.e.lllm.networkErrorOpenAI, {
              URL: this.url,
            }) +
              " " +
              message,
            { code: "TIMEOUT_ERROR", cause: err },
          );
        }
        if (
          isNodeError(err) &&
          (err.name === "AbortError" || isTypeError(err))
        ) {
          let message = simpleTemplate(
            this.appState.s.e.lllm.networkErrorOpenAI,
            {
              URL: this.url,
            },
          );
          const cause = err.cause as { code?: string } | undefined;
          if (cause?.code) {
            message += simpleTemplate(
              this.appState.s.e.lllm.networkErrorReason,
              {
                Code: cause.code,
              },
            );
          }
          throw createError(message, { cause: err });
        }
        throw err;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let doneSignalReceived = false;

      if (!response.body) {
        throw createError(this.appState.s.e.lllm.responseNull, {
          code: "NULL_RESPONSE_BODY",
        });
      }
      reader =
        response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          if (idleTimeout) {
            startTimeout(this.appState.s.e.lllm.tExceeded);
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.trim() === "" || !line.startsWith("data: ")) continue;

            const data = line.substring(6).trim();
            if (data === "[DONE]") {
              doneSignalReceived = true;
              return;
            }

            const chunk = JSON.parse(data) as OpenAIStreamChunk;
            const contentDelta = chunk?.choices?.[0]?.delta?.content;
            if (contentDelta) yield contentDelta;
          }
        }
        if (!doneSignalReceived && !controller.signal.aborted) {
          throw createError(this.appState.s.e.lllm.streamEndedPrematurely, {
            code: "STREAM_PREMATURE_END",
          });
        }
      } finally {
        try {
          if (reader?.cancel) {
            await reader.cancel();
          }
        } catch {
          /* intentionally ignored */
        }

        try {
          reader?.releaseLock?.();
        } catch {
          /* intentionally ignored */
        }

        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    } catch (err) {
      try {
        if (reader?.cancel) await reader.cancel(err);
      } catch {
        /* intentionally ignored */
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      throw err;
    }
  }

  protected async chatCompletions(
    messages: Message[],
    { verbose = false }: { verbose?: boolean | ((chunk: string) => void) } = {},
  ): Promise<string> {
    const chunks: string[] = [];
    const idleTimeout = !!verbose;

    const wrapper =
      verbose === true
        ? new StreamedLineWrapper(
            this.appState.TERMINAL_WIDTH,
            async (chunk) => {
              await new Promise<void>((resolve) => {
                if (process.stdout.write(chunk)) resolve();
                else process.stdout.once("drain", resolve);
              });
            },
          )
        : null;

    for await (const chunk of this.chatCompletionsStream(messages, {
      idleTimeout,
    })) {
      if (typeof verbose === "function") {
        verbose(chunk);
      } else if (wrapper) {
        await wrapper.write(chunk);
      }
      chunks.push(chunk);
    }

    if (wrapper) {
      await wrapper.flush();
    }

    return chunks.join("");
  }

  public newPrompt(chunk: string): Message[] {
    const messages: Message[] = [];

    if (this.systemPrompt?.[0]) {
      const systemMessage: Message = {
        role: this.systemPrompt[2] as "system",
        content: this.systemPrompt[1],
      };
      messages.push(systemMessage);
    }

    const userText =
      (this.prependPrompt?.[0] ? this.prependPrompt[1] : "") + chunk;
    const userRole = this.prependPrompt?.[2] ?? "user";

    let userMessage: Message = {
      role: userRole as "user" | "assistant",
      content: userText,
    };

    userMessage = this.injectImages(userMessage);

    messages.push(userMessage);

    return messages;
  }

  public injectImages(message: Message, images?: string[]): Message {
    const imagesToInject = images ?? this.images;

    if (!imagesToInject || imagesToInject.length === 0) {
      return message;
    }

    if (typeof message.content !== "string") {
      return message;
    }

    const contentParts: (TextContentPart | ImageContentPart)[] = [];
    contentParts.push({ type: "text", text: message.content });

    for (const imageUrl of imagesToInject) {
      contentParts.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
    }

    const modifiedMessage: Message = {
      ...message,
      content: contentParts,
    };

    return modifiedMessage;
  }

  public toString(): string {
    return JSON.stringify(this, (key: string, value: unknown) => {
      if (key === "chunks" || key === "text" || key === "processedBatch") {
        return undefined;
      }
      if (key === "apiKey" && value && !this.appState.DEBUG_MODE) {
        return this.appState.s.m.lcli.redacted;
      }
      return value;
    });
  }
}
