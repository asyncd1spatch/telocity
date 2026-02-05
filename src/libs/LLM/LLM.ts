import {
  config as appConfig,
  AppStateSingleton,
  createError,
  isNodeError,
  isTypeError,
  resolveConfig,
  simpleTemplate,
  StreamedLineWrapper,
  V,
} from "../core/index.ts";
import type {
  AppState,
  ChatCompletionsPayload,
  ConfigMap,
  DelayTuple,
  ImageContentPart,
  LLMBackend,
  LLMConfigurableProps,
  MappableParamKey,
  Message,
  NumberParam,
  OpenAIResponse,
  OutputItem,
  ParsedStreamChunk,
  PromptParam,
  ResponsesInputContentPart,
  ResponsesMessage,
  ResponsesPayload,
  StringParam,
  TextContentPart,
} from "../types/index.ts";

let _ARG_CONFIG: ConfigMap<LLM & LLMConfigurableProps, LLMConfigurableProps>;

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
    chunkSize: {
      prop: "chunkSize" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { minExclusive: 0, max: 200000, integer: true, allowNaN: false },
        appState.s.e.v.invalidChunkSize,
        "INVALID_CHUNK_SIZE",
        "{{ .ChunkSize }}",
      ),
    },
    batchSize: {
      prop: "batchSize" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { minExclusive: 0, max: 512, integer: true, allowNaN: false },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
      ),
    },
    parallel: {
      prop: "parallel" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { minExclusive: 0, max: 64, integer: true, allowNaN: false },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
      ),
    },
    llmbackend: {
      prop: "llmbackend" as keyof (LLM & LLMConfigurableProps),
      validate: V.str(
        { notEmpty: true },
        appState.s.e.v.invalidText,
        "INVALID_TEXT",
        " {{ .Text }}",
      ),
    },
    chatMode: {
      prop: "chatMode" as keyof (LLM & LLMConfigurableProps),
      validate: V.bool(
        { strictTrueFalse: true },
        appState.s.e.v.invalidChatMode,
        "INVALID_CHAT_MODE",
      ),
    },
    url: {
      prop: "url" as keyof (LLM & LLMConfigurableProps),
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
      prop: "apiKey" as keyof (LLM & LLMConfigurableProps),
      validate: V.str(
        {},
        appState.s.e.v.invalidAPIKey,
        "INVALID_API_KEY",
        "{{ .APIKey }}",
      ),
    },
    images: {
      prop: "images" as keyof (LLM & LLMConfigurableProps),
      validate: validateImageArray,
    },
    delay: {
      prop: "delay" as keyof (LLM & LLMConfigurableProps),
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
      prop: "model" as keyof (LLM & LLMConfigurableProps),
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
      prop: "temperature" as keyof (LLM & LLMConfigurableProps),
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
      prop: "top_p" as keyof (LLM & LLMConfigurableProps),
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
      prop: "top_k" as keyof (LLM & LLMConfigurableProps),
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
      prop: "presence_penalty" as keyof (LLM & LLMConfigurableProps),
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
      prop: "seed" as keyof (LLM & LLMConfigurableProps),
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
      prop: "systemPrompt" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str({}, appState.s.e.v.invalidPrompt, "INVALID_PROMPT"),
    },
    prependPrompt: {
      prop: "prependPrompt" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str({}, appState.s.e.v.invalidPrompt, "INVALID_PROMPT"),
    },
    prefill: {
      prop: "prefill" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.str({}, appState.s.e.v.invalidPrompt, "INVALID_PROMPT"),
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
  ] as const;

  return _OPT_PARAMS;
}

export class LLM {
  public static readonly TerminationState = Object.freeze({
    NONE: "none",
    REQUESTED: "requested",
    FORCEFUL: "forceful",
  } as const);

  protected readonly llmbackend: LLMBackend = "chatcompletions";
  protected readonly url: string = "http://localhost:8080/v1/chat/completions";
  protected readonly apiKey: string = "";
  protected readonly delay: DelayTuple = [true, 60000];
  protected readonly batchSize: number = 1;
  protected readonly parallel: number = 1;
  protected readonly chunkSize: number = 1;
  protected readonly chatMode: boolean = false;
  protected readonly model?: StringParam;
  protected readonly temperature?: NumberParam;
  protected readonly top_p?: NumberParam;
  protected readonly top_k?: NumberParam;
  protected readonly presence_penalty?: NumberParam;
  protected readonly seed?: NumberParam;
  protected readonly systemPrompt?: PromptParam;
  protected readonly prependPrompt?: PromptParam;
  protected readonly prefill?: PromptParam;
  protected readonly images?: string[];
  protected readonly abrtTimeout: number; // In milliseconds
  protected readonly appState: AppState;
  protected lastReasoningEncrypted: string | null = null;
  protected lastReasoningUnencrypted: string | null = null;
  protected lastReasoningSummary: string | null = null;

  public completion: (
    messages: Message[],
    options?: {
      verbose?: boolean | ((chunk: string) => void);
      overrides?: Partial<LLMConfigurableProps>;
    },
  ) => Promise<string>;

  constructor(
    options: LLMConfigurableProps,
    llmcall?: (
      messages: Message[],
      options?: {
        verbose?: boolean | ((chunk: string) => void);
        overrides?: Partial<LLMConfigurableProps>;
      },
    ) => Promise<string>,
  ) {
    this.appState = AppStateSingleton.getInstance();
    this.abrtTimeout = appConfig.HUMAN_TIMEOUT * 60000;

    const resolvedState = resolveConfig<
      LLM & LLMConfigurableProps,
      LLMConfigurableProps
    >(this as unknown as LLM & LLMConfigurableProps, options, getArgConfig());

    Object.assign(this, resolvedState);

    let tmpcall;
    switch (this.llmbackend) {
      case "chatcompletions":
      case "responses":
      default:
        tmpcall = this.infer.bind(this);
        break;
    }
    this.completion = llmcall || tmpcall;
  }

  private processOutputItem(item: OutputItem): string {
    let text = "";

    if (item.type === "message") {
      text = item.content.map((c) => c.text).join("");
    } else if (item.type === "reasoning") {
      if (item.encrypted_content) {
        this.lastReasoningEncrypted = item.encrypted_content;
      }

      if (Array.isArray(item.content)) {
        const collected = item.content.map((part) => part.text).join("");
        if (collected) {
          this.lastReasoningUnencrypted =
            (this.lastReasoningUnencrypted ?? "") + collected;
        }
      }

      if (Array.isArray(item.summary)) {
        const summaryText = item.summary.map((s) => s.text).join("");
        if (summaryText) {
          this.lastReasoningSummary = summaryText;
          if (this.appState.DEBUG_MODE) {
            console.log("[Reasoning Summary]:", summaryText);
          }
        }
      }
    }
    return text;
  }

  private async makeRequest(
    payload: ChatCompletionsPayload | ResponsesPayload,
    controller: AbortController,
  ): Promise<Response> {
    try {
      const response = await fetch(this.url, {
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

      return response;
    } catch (err) {
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
      if (isNodeError(err) && (err.name === "AbortError" || isTypeError(err))) {
        let message = simpleTemplate(
          this.appState.s.e.lllm.networkErrorOpenAI,
          {
            URL: this.url,
          },
        );
        const cause = err.cause as { code?: string } | undefined;
        if (cause?.code) {
          message += simpleTemplate(this.appState.s.e.lllm.networkErrorReason, {
            Code: cause.code,
          });
        }
        throw createError(message, { cause: err });
      }
      throw err;
    }
  }

  private buildPayload(
    messages: Message[],
    stream: boolean,
    overrides?: Partial<LLMConfigurableProps>,
  ): ChatCompletionsPayload | ResponsesPayload {
    const OPT_PARAMS = getOptParams();

    const finalMessages: Message[] = [...messages];
    if (this.prefill?.[0]) {
      finalMessages.push({
        role: "assistant",
        content: this.prefill[1],
      });
    }

    const commonParams: Record<string, unknown> = {};

    for (const k of OPT_PARAMS) {
      const overrideVal = overrides?.[k as keyof LLMConfigurableProps];
      if (overrideVal !== undefined) {
        commonParams[k] = Array.isArray(overrideVal)
          ? overrideVal[1]
          : overrideVal;
      } else {
        const prop = this[k as keyof this];
        if (Array.isArray(prop) && prop[0]) {
          commonParams[k] = prop[1];
        }
      }
    }

    if (this.llmbackend === "chatcompletions") {
      return {
        messages: finalMessages,
        stream,
        ...commonParams,
      } as ChatCompletionsPayload;
    } else {
      let instructions: string | undefined;

      const inputMessages = finalMessages.reduce<ResponsesMessage[]>(
        (acc, msg) => {
          if (msg.role === "system") {
            const content =
              typeof msg.content === "string" ? msg.content : "System Prompt";
            instructions = instructions
              ? instructions + "\n" + content
              : content;
          } else {
            const newContent: ResponsesInputContentPart[] = [];

            const textType =
              msg.role === "assistant" ? "output_text" : "input_text";

            if (typeof msg.content === "string") {
              newContent.push({ type: textType, text: msg.content });
            } else {
              for (const part of msg.content) {
                if (part.type === "text") {
                  newContent.push({ type: textType, text: part.text });
                } else if (part.type === "image_url") {
                  newContent.push({
                    type: "input_image",
                    image_url: part.image_url.url,
                  });
                }
              }
            }

            acc.push({
              type: "message",
              role: msg.role,
              content: newContent,
            });
          }
          return acc;
        },
        [],
      );

      const payload: ResponsesPayload = {
        input: inputMessages,
        instructions,
        stream,
        store: false,
        ...commonParams,
      };

      if (this.chatMode) {
        payload.include = ["reasoning.encrypted_content", "reasoning"];
        payload.reasoning = {
          summary: "auto",
        };
      }

      return payload;
    }
  }

  private async *readSSEAndParse(
    payload: ChatCompletionsPayload | ResponsesPayload,
    controller: AbortController,
    parseFn: (
      parsed: ParsedStreamChunk,
    ) => Array<{ text: string; kind: "delta" | "output" | "conditional" }>,
    { idleTimeout = false } = {},
  ): AsyncGenerator<string, void, unknown> {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let response: Response | null = null;

    // NOTE: idle vs hard timeouts share the same duration (abrtTimeout);
    // the difference is whether activity resets the timer.
    const startAbortTimer = (reason: string | Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      const abortReason =
        reason instanceof Error ? reason : new Error(String(reason));
      timeoutId = setTimeout(() => {
        controller.abort(abortReason);
      }, this.abrtTimeout);
    };

    startAbortTimer(
      idleTimeout
        ? this.appState.s.e.lllm.idleTimeOut
        : this.appState.s.e.lllm.hardTimeOut,
    );

    try {
      try {
        response = await this.makeRequest(payload, controller);
      } catch (err) {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
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
        let emittedAnyDelta = false;

        while (true) {
          const { done, value } = await reader.read();

          if (idleTimeout) {
            startAbortTimer(this.appState.s.e.lllm.tExceeded);
          }

          if (done) {
            buffer += decoder.decode();
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          if (buffer.includes("\r")) {
            buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          }

          let eventEndIndex: number;

          while ((eventEndIndex = buffer.indexOf("\n\n")) >= 0) {
            const part = buffer.slice(0, eventEndIndex);
            buffer = buffer.slice(eventEndIndex + 2);

            if (!part.trim()) continue;

            const lines = part.split("\n");
            let eventData = "";
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("data:")) {
                const dataContent = trimmed.substring(5).trim();
                eventData += (eventData ? "\n" : "") + dataContent;
              }
            }

            if (!eventData) continue;
            if (eventData === "[DONE]") {
              doneSignalReceived = true;
              break;
            }

            try {
              const parsed = JSON.parse(eventData) as ParsedStreamChunk;
              const items = parseFn(parsed);

              for (const it of items) {
                if (it.kind === "conditional" || it.kind === "output") {
                  if (!emittedAnyDelta) {
                    yield it.text;
                  }
                } else {
                  emittedAnyDelta = true;
                  yield it.text;
                }
              }
            } catch {
              /* ignore */
            }
          }

          if (doneSignalReceived) break;
        }
      } finally {
        try {
          if (reader?.cancel) await reader.cancel();
        } catch {
          /* ignore */
        }
        try {
          reader?.releaseLock?.();
        } catch {
          /* ignore */
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
        /* ignore */
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      throw err;
    }
  }

  private parseResponsesChunk(
    chunk: ParsedStreamChunk,
  ): Array<{ text: string; kind: "delta" | "output" | "conditional" }> {
    const out: Array<{
      text: string;
      kind: "delta" | "output" | "conditional";
    }> = [];

    if (
      (chunk.type === "response.output_text.delta" ||
        chunk.type === "response.refusal.delta") &&
      chunk.delta
    ) {
      out.push({ text: chunk.delta, kind: "delta" });
    } else if (chunk.type === "response.reasoning_text.delta" && chunk.delta) {
      this.lastReasoningUnencrypted =
        (this.lastReasoningUnencrypted ?? "") + chunk.delta;
      out.push({ text: chunk.delta, kind: "delta" });
    } else if (
      (chunk.type === "response.output_text.done" ||
        chunk.type === "response.refusal.done") &&
      chunk.text
    ) {
      out.push({ text: chunk.text, kind: "conditional" });
    } else if (
      (chunk.type === "response.output_item.added" ||
        chunk.type === "response.output_item.done") &&
      chunk.item
    ) {
      const text = this.processOutputItem(chunk.item);
      if (text) out.push({ text, kind: "output" });
    } else if (Array.isArray(chunk.output)) {
      for (const item of chunk.output) {
        const text = this.processOutputItem(item);
        if (text) out.push({ text, kind: "output" });
      }
    } else if (chunk.choices?.[0]?.delta?.content) {
      out.push({ text: chunk.choices[0].delta.content, kind: "delta" });
    }

    return out;
  }

  private parseChatCompletionsChunk(
    chunk: ParsedStreamChunk,
  ): Array<{ text: string; kind: "delta" | "output" | "conditional" }> {
    const content = chunk.choices?.[0]?.delta?.content;
    return content ? [{ text: content, kind: "delta" }] : [];
  }

  protected async *responsesStream(
    messages: Message[],
    options: {
      idleTimeout?: boolean;
      overrides?: Partial<LLMConfigurableProps>;
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const payload = this.buildPayload(messages, true, options.overrides);
    for await (const chunk of this.readSSEAndParse(
      payload,
      controller,
      this.parseResponsesChunk.bind(this),
      { idleTimeout: options.idleTimeout },
    )) {
      yield chunk;
    }
  }

  protected async *chatCompletionsStream(
    messages: Message[],
    options: {
      idleTimeout?: boolean;
      overrides?: Partial<LLMConfigurableProps>;
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    const controller = new AbortController();
    const payload = this.buildPayload(messages, true, options.overrides);
    for await (const chunk of this.readSSEAndParse(
      payload,
      controller,
      this.parseChatCompletionsChunk.bind(this),
      { idleTimeout: options.idleTimeout },
    )) {
      yield chunk;
    }
  }

  protected async *inferStream(
    messages: Message[],
    options: {
      idleTimeout?: boolean;
      overrides?: Partial<LLMConfigurableProps>;
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    if (this.llmbackend === "responses") {
      for await (const c of this.responsesStream(messages, options)) {
        yield c;
      }
    } else {
      for await (const c of this.chatCompletionsStream(messages, options)) {
        yield c;
      }
    }
  }

  protected async inferBatch(
    messages: Message[],
    overrides?: Partial<LLMConfigurableProps>,
  ): Promise<string> {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const startAbortTimer = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        controller.abort(new Error(this.appState.s.e.lllm.hardTimeOut));
      }, this.abrtTimeout);
    };

    startAbortTimer();

    try {
      const payload = this.buildPayload(messages, false, overrides);
      const resp = await this.makeRequest(payload, controller);
      const data = (await resp.json()) as OpenAIResponse;
      const results: string[] = [];

      if (this.llmbackend === "responses") {
        const output = data.output || data.response?.output;
        if (Array.isArray(output)) {
          for (const item of output) {
            results.push(this.processOutputItem(item));
          }
        }

        if (typeof data.text === "string") {
          results.push(data.text);
        } else if (data.text?.content) {
          results.push(data.text.content);
        }

        return results.filter(Boolean).join("");
      }

      // OpenAI Chat Completions
      const firstChoice = data.choices?.[0];
      if (firstChoice?.message?.content) {
        return firstChoice.message.content;
      }

      return "";
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  protected async infer(
    messages: Message[],
    {
      verbose = false,
      overrides,
    }: {
      verbose?: boolean | ((chunk: string) => void);
      overrides?: Partial<LLMConfigurableProps>;
    } = {},
  ): Promise<string> {
    // Node's fetch enforces a hard timeout (~5min), avoid it by always
    // streaming on Node, even when not verbose, to keep the connection alive.
    // Bun has no enforced fetch timeout, so non-streaming is safe there.
    const isBun =
      typeof globalThis === "object" &&
      "Bun" in globalThis &&
      globalThis.Bun !== undefined;
    if (!verbose && isBun) {
      return await this.inferBatch(messages, overrides);
    }

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

    for await (const chunk of this.inferStream(messages, {
      idleTimeout,
      overrides,
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

    const rawPrepPrompt = this.prependPrompt?.[0] ? this.prependPrompt[1] : "";
    let userText: string;

    if (rawPrepPrompt.includes("{{ .TextToInject }}")) {
      userText = simpleTemplate(rawPrepPrompt, { TextToInject: chunk });
    } else {
      userText = rawPrepPrompt + chunk;
    }

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

  public getLastReasoning(preferUnencrypted = true): {
    encrypted: string | null;
    unencrypted: string | null;
    preferred: string | null;
  } {
    const enc = this.lastReasoningEncrypted;
    const unenc = this.lastReasoningUnencrypted;
    const preferred = preferUnencrypted ? (unenc ?? enc) : (enc ?? unenc);
    return { encrypted: enc, unencrypted: unenc, preferred: preferred ?? null };
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
