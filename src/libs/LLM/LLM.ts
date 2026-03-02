import {
  config as appConfig,
  AppStateSingleton,
  createError,
  resolveConfig,
  simpleTemplate,
  StreamedLineWrapper,
  V,
} from "../core/index.ts";
import type {
  AppState,
  BackendStrategy,
  ChatCompletionsPayload,
  CompletionsPayload,
  ConfigMap,
  ConfigParam,
  ImageContentPart,
  IReasoningTracker,
  LLMConfigurableProps,
  MappableParamKey,
  Message,
  NumberParam,
  OutputItem,
  ParsedStreamChunk,
  PromptParam,
  ReasoningEffortValue,
  ResponsesInputContentPart,
  ResponsesMessage,
  ResponsesPayload,
  StrategyContext,
  StringParam,
  TextContentPart,
} from "../types/index.ts";
import { VALID_REASONING_EFFORT_VALUES } from "../types/index.ts";

let _ARG_CONFIG: ConfigMap<LLM & LLMConfigurableProps, LLMConfigurableProps>;

function getArgConfig() {
  if (_ARG_CONFIG) {
    return _ARG_CONFIG;
  }
  const appState = AppStateSingleton.getInstance();

  const validReasoningEfforts = new Set<string>(VALID_REASONING_EFFORT_VALUES);

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
        { minExclusive: 0, max: 200000, integer: true },
        appState.s.e.v.invalidChunkSize,
        "INVALID_CHUNK_SIZE",
        "{{ .ChunkSize }}",
      ),
    },
    batchSize: {
      prop: "batchSize" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { minExclusive: 0, max: 512, integer: true },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
      ),
    },
    parallel: {
      prop: "parallel" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { minExclusive: 0, max: 64, integer: true },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
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
      validate: V.num(
        { min: 0 },
        appState.s.e.v.invalidDelayValue,
        "INVALID_DELAY_VALUE",
      ),
    },
    maxAttempts: {
      prop: "maxAttempts" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { min: 1, integer: true },
        simpleTemplate(appState.s.e.v.invalidOption, { Value: "maxAttempts" }),
        "INVALID_MAX_ATTEMPTS",
      ),
    },
    tempIncrement: {
      prop: "tempIncrement" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { min: 0, max: 2 },
        simpleTemplate(appState.s.e.v.invalidOption, {
          Value: "tempIncrement",
        }),
        "INVALID_TEMP_INCREMENT",
      ),
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
        { min: 0, max: 2 },
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
        { min: 0, max: 1 },
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
        { min: 0, integer: true },
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
        { min: -2, max: 2 },
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
        { min: 1, integer: true },
        appState.s.e.v.seedMustBePositiveInteger,
        "INVALID_SEED",
      ),
    },
    timeout: {
      prop: "timeout" as keyof (LLM & LLMConfigurableProps),
      validate: V.num(
        { min: 0.1, max: Math.floor(2_147_483_647 / 60000) },
        simpleTemplate(appState.s.e.v.invalidOption, { Value: "timeout" }),
        "INVALID_TIMEOUT",
      ),
    },
    reasoning_effort: {
      /* official v1/chat/completions */
      prop: "reasoning_effort" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: (val: unknown) => {
        if (typeof val !== "string" || !validReasoningEfforts.has(val)) {
          throw createError(
            simpleTemplate(appState.s.e.v.invalidOption, {
              Value: String(val),
            }),
            { code: "INVALID_REASONING_EFFORT" },
          );
        }
      },
    },
    chat_template_kwargs: {
      /* llama.cpp */
      prop: "chat_template_kwargs" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: (val: unknown) => {
        if (val === undefined || val === null) {
          return;
        }
        if (typeof val !== "object") {
          throw createError(
            simpleTemplate(appState.s.e.v.invalidOption, {
              Value: JSON.stringify(val),
            }),
            { code: "INVALID_KWARGS_TYPE" },
          );
        }
        const kwargs = val as Record<string, unknown>;
        if ("reasoning_effort" in kwargs) {
          const effort = kwargs["reasoning_effort"];
          if (
            typeof effort !== "string" ||
            !validReasoningEfforts.has(effort)
          ) {
            throw createError(
              simpleTemplate(appState.s.e.v.invalidOption, {
                Value: JSON.stringify(val),
              }),
              { code: "INVALID_REASONING_EFFORT" },
            );
          }
        }
        if ("enable_thinking" in kwargs) {
          if (typeof kwargs["enable_thinking"] !== "boolean") {
            throw createError(
              simpleTemplate(appState.s.e.v.invalidOption, {
                Value: JSON.stringify(val),
              }),
              { code: "INVALID_ENABLE_THINKING" },
            );
          }
        }
      },
    },
    reasoning: {
      /* official v1/responses */
      prop: "reasoning" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: (val: unknown) => {
        if (val === undefined || val === null) {
          return;
        }
        if (typeof val !== "object") {
          throw createError(
            simpleTemplate(appState.s.e.v.invalidOption, {
              Value: JSON.stringify(val),
            }),
            { code: "INVALID_REASONING_TYPE" },
          );
        }
        if (!("effort" in val)) {
          return;
        }
        const effort = (val as { effort: unknown }).effort;
        if (typeof effort !== "string" || !validReasoningEfforts.has(effort)) {
          throw createError(
            simpleTemplate(appState.s.e.v.invalidOption, {
              Value: JSON.stringify(val),
            }),
            { code: "INVALID_REASONING_EFFORT" },
          );
        }
      },
    },
    enable_thinking: {
      /* Alibaba Cloud Model Studio */
      prop: "enable_thinking" as keyof (LLM & LLMConfigurableProps),
      getValue: V.getValueFromArray(
        appState.s.e.v.invalidArgArray,
        "INVALID_ARRAY",
      ),
      validate: V.bool(
        { strictTrueFalse: true },
        simpleTemplate(appState.s.e.v.invalidOption, {
          Value: "enable_thinking",
        }),
        "INVALID_ENABLE_THINKING",
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
    keepAlive: {
      prop: "keepAlive" as keyof (LLM & LLMConfigurableProps),
      validate: V.bool(
        { strictTrueFalse: true },
        appState.s.e.v.invalidKeepAlive,
        "INVALID_KEEPALIVE",
      ),
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
    "reasoning_effort", // v1/chat/completions official
    "chat_template_kwargs", // llama.cpp
    "reasoning", // v1/responses official
    "enable_thinking", // Alibaba Cloud Model Studio
  ] as const;

  return _OPT_PARAMS;
}

export class ReasoningTracker implements IReasoningTracker {
  public encrypted: string | null = null;
  public unencrypted: string | null = null;
  public summary: string | null = null;

  public processOutputItem(item: OutputItem): string {
    let text = "";

    if (item.type === "message") {
      text = item.content.map((c) => c.text).join("");
    } else if (item.type === "reasoning") {
      if (item.encrypted_content) {
        this.encrypted = item.encrypted_content;
      }

      if (Array.isArray(item.content)) {
        const collected = item.content.map((part) => part.text).join("");
        if (collected) {
          this.unencrypted = (this.unencrypted ?? "") + collected;
        }
      }

      if (Array.isArray(item.summary)) {
        const summaryText = item.summary.map((s) => s.text).join("");
        if (summaryText) {
          this.summary = summaryText;
        }
      }
    }
    return text;
  }

  public appendUnencrypted(delta: string) {
    this.unencrypted = (this.unencrypted ?? "") + delta;
  }
}

class StreamController {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private abortController: AbortController;

  constructor(private timeoutMs: number) {
    this.abortController = new AbortController();
  }

  public startTimer(reason: string) {
    this.clearTimer();
    const abortError = new Error(reason);
    abortError.name = "AbortError";
    this.timeoutId = setTimeout(() => {
      this.abortController.abort(abortError);
    }, this.timeoutMs);
  }

  public clearTimer() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public abort(reason?: unknown) {
    this.abortController.abort(reason);
  }

  public get signal() {
    return this.abortController.signal;
  }
}

class ChatCompletionsStrategy implements BackendStrategy {
  buildPayload(
    messages: Message[],
    ctx: StrategyContext,
  ): ChatCompletionsPayload {
    const finalMessages: Message[] = [...messages];

    const hasPrefill = ctx.prefill?.[0];
    const prevReasoning = ctx.previousReasoning;
    const hasReasoning = !!(
      prevReasoning &&
      (prevReasoning.unencrypted || prevReasoning.encrypted)
    );

    if (hasPrefill || hasReasoning) {
      const assistantMsg: Message = {
        role: "assistant",
        content: hasPrefill ? ctx.prefill![1] : "",
      };

      if (hasReasoning) {
        if (prevReasoning?.unencrypted) {
          assistantMsg.reasoning_content = prevReasoning.unencrypted;
        }
        if (prevReasoning?.encrypted) {
          assistantMsg.encrypted_reasoning = prevReasoning.encrypted;
        }
      }

      finalMessages.push(assistantMsg);
    }

    return {
      messages: finalMessages,
      ...ctx.commonParams,
      stream: true,
    } as ChatCompletionsPayload;
  }

  parseChunk(
    chunk: ParsedStreamChunk,
    ctx: StrategyContext,
  ): Array<{ text: string; kind: "delta" | "output" | "conditional" }> {
    const out: Array<{
      text: string;
      kind: "delta" | "output" | "conditional";
    }> = [];

    const delta = chunk.choices?.[0]?.delta;
    const message = chunk.choices?.[0]?.message;

    // llama.cpp and deepseek APIs
    if (delta?.reasoning_content) {
      ctx.reasoningTracker.appendUnencrypted(delta.reasoning_content);
    } else if (message?.reasoning_content) {
      ctx.reasoningTracker.appendUnencrypted(message.reasoning_content);
    }

    if (delta?.content) {
      out.push({ text: delta.content, kind: "delta" });
    } else if (message?.content) {
      out.push({ text: message.content, kind: "conditional" });
    }

    return out;
  }
}

class CompletionsStrategy implements BackendStrategy {
  buildPayload(messages: Message[], ctx: StrategyContext): CompletionsPayload {
    const finalMessages: Message[] = [...messages];
    if (ctx.prefill?.[0]) {
      finalMessages.push({
        role: "assistant",
        content: ctx.prefill[1],
      });
    }

    const prompt = finalMessages.reduce((acc, msg) => {
      let content = "";
      if (typeof msg.content === "string") {
        content = msg.content;
      } else {
        content = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("");
      }
      return acc + content;
    }, "");

    return {
      prompt,
      ...ctx.commonParams,
      stream: true,
    } as CompletionsPayload;
  }

  parseChunk(
    chunk: ParsedStreamChunk,
    _ctx: StrategyContext,
  ): Array<{ text: string; kind: "delta" | "output" | "conditional" }> {
    const completionsChunk = chunk as unknown as {
      choices?: Array<{ text?: string }>;
    };
    const text = completionsChunk.choices?.[0]?.text;
    return typeof text === "string" ? [{ text, kind: "delta" }] : [];
  }
}

class ResponsesStrategy implements BackendStrategy {
  buildPayload(messages: Message[], ctx: StrategyContext): ResponsesPayload {
    const finalMessages: Message[] = [...messages];

    const hasPrefill = ctx.prefill?.[0];
    const prevReasoning = ctx.previousReasoning;
    const hasReasoning = !!(
      prevReasoning &&
      (prevReasoning.unencrypted || prevReasoning.encrypted)
    );

    if (hasPrefill || hasReasoning) {
      const assistantMsg: Message = {
        role: "assistant",
        content: hasPrefill ? ctx.prefill![1] : "",
      };

      if (hasReasoning) {
        if (prevReasoning?.unencrypted) {
          assistantMsg.reasoning_content = prevReasoning.unencrypted;
        }
        if (prevReasoning?.encrypted) {
          assistantMsg.encrypted_reasoning = prevReasoning.encrypted;
        }
      }

      finalMessages.push(assistantMsg);
    }

    let instructions: string | undefined;

    const inputMessages = finalMessages.reduce<ResponsesMessage[]>(
      (acc, msg) => {
        if (msg.role === "system") {
          const content =
            typeof msg.content === "string" ? msg.content : "System Prompt";
          instructions = instructions ? instructions + "\n" + content : content;
        } else {
          const newContent: ResponsesInputContentPart[] = [];
          const textType =
            msg.role === "assistant" ? "output_text" : "input_text";

          if (typeof msg.content === "string") {
            if (msg.content !== "") {
              newContent.push({ type: textType, text: msg.content });
            }
          } else {
            for (const part of msg.content) {
              if (part.type === "text" && part.text !== "") {
                newContent.push({ type: textType, text: part.text });
              } else if (part.type === "image_url") {
                newContent.push({
                  type: "input_image",
                  image_url: part.image_url.url,
                });
              }
            }
          }

          type ExtendedResponsesMessage = ResponsesMessage & {
            reasoning_content?: string;
            encrypted_reasoning?: string;
          };

          const responseMsg: ExtendedResponsesMessage = {
            type: "message",
            role: msg.role,
            content: newContent,
          };

          if (msg.reasoning_content) {
            responseMsg.reasoning_content = msg.reasoning_content;
          }
          if (msg.encrypted_reasoning) {
            responseMsg.encrypted_reasoning = msg.encrypted_reasoning;
          }

          acc.push(responseMsg);
        }
        return acc;
      },
      [],
    );

    const payload = {
      input: inputMessages,
      instructions,
      store: false,
      ...ctx.commonParams,
      stream: true,
    } as ResponsesPayload;

    if (ctx.chatMode) {
      payload.include = ["reasoning.encrypted_content", "reasoning"];
    }
    return payload;
  }

  parseChunk(
    chunk: ParsedStreamChunk,
    ctx: StrategyContext,
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
      ctx.reasoningTracker.appendUnencrypted(chunk.delta);
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
      const text = ctx.reasoningTracker.processOutputItem(chunk.item);
      if (text) out.push({ text, kind: "output" });
    } else if (Array.isArray(chunk.output)) {
      for (const item of chunk.output) {
        const text = ctx.reasoningTracker.processOutputItem(item);
        if (text) out.push({ text, kind: "output" });
      }
    } else if (chunk.choices?.[0]?.delta?.content) {
      out.push({ text: chunk.choices[0].delta.content, kind: "delta" });
    }

    return out;
  }
}

export class LLM {
  public static readonly TerminationState = Object.freeze({
    NONE: "none",
    REQUESTED: "requested",
    FORCEFUL: "forceful",
  } as const);

  protected readonly url: string = "http://localhost:8080/v1/chat/completions";
  protected readonly apiKey: string = "";
  protected readonly delay: number = 60000;
  protected readonly batchSize: number = 1;
  protected readonly parallel: number = 1;
  protected readonly chunkSize: number = 1;
  protected readonly chatMode: boolean = false;
  protected readonly keepAlive: boolean = true;
  protected readonly maxAttempts: number = 7;
  protected readonly tempIncrement: number = 0.15;
  protected readonly model?: StringParam;
  protected readonly temperature?: NumberParam;
  protected readonly top_p?: NumberParam;
  protected readonly top_k?: NumberParam;
  protected readonly presence_penalty?: NumberParam;
  protected readonly seed?: NumberParam;
  protected readonly timeout?: number;
  protected readonly reasoning_effort?: ConfigParam<ReasoningEffortValue>; // v1/chat/completions
  protected readonly chat_template_kwargs?: ConfigParam<{
    reasoning_effort: ReasoningEffortValue;
  }>; // llama.cpp
  protected readonly reasoning?: ConfigParam<{ effort: ReasoningEffortValue }>; // v1/responses
  protected readonly enable_thinking?: ConfigParam<boolean>; // Alibaba Cloud Model Studio
  protected readonly systemPrompt?: PromptParam;
  protected readonly prependPrompt?: PromptParam;
  protected readonly prefill?: PromptParam;
  protected readonly images?: string[];
  protected readonly abrtTimeout: number; // In milliseconds
  protected readonly appState: AppState;

  protected readonly reasoningTracker: ReasoningTracker;
  protected readonly strategy: BackendStrategy;

  public completion: (
    messages: Message[],
    options?: {
      verbose?: boolean | ((chunk: string) => Promise<void>);
      overrides?: Partial<LLMConfigurableProps>;
      signal?: AbortSignal;
    },
  ) => Promise<string>;

  constructor(
    options: LLMConfigurableProps,
    llmcall?: (
      messages: Message[],
      options?: {
        verbose?: boolean | ((chunk: string) => Promise<void>);
        overrides?: Partial<LLMConfigurableProps>;
        signal?: AbortSignal;
      },
    ) => Promise<string>,
  ) {
    this.appState = AppStateSingleton.getInstance();

    const argConfig: ConfigMap<
      LLM & LLMConfigurableProps,
      LLMConfigurableProps
    > = getArgConfig();

    const timeoutValidator: ((val: unknown) => void) | undefined =
      argConfig.timeout?.validate;

    if (timeoutValidator) {
      timeoutValidator(appConfig.TIMEOUT);
    }

    const resolvedState = resolveConfig<
      LLM & LLMConfigurableProps,
      LLMConfigurableProps
    >(this as unknown as LLM & LLMConfigurableProps, options, argConfig);

    Object.assign(this, resolvedState);

    this.reasoningTracker = new ReasoningTracker();

    if (this.url.endsWith("/responses")) {
      this.strategy = new ResponsesStrategy();
    } else if (
      this.url.endsWith("/completions") &&
      !this.url.endsWith("/chat/completions")
    ) {
      this.strategy = new CompletionsStrategy();
    } else {
      this.strategy = new ChatCompletionsStrategy();
    }

    let timeoutMs = appConfig.TIMEOUT * 60000;
    if (this.timeout !== undefined) {
      timeoutMs = this.timeout * 60000;
    }
    this.abrtTimeout = timeoutMs;

    this.completion = llmcall || this.infer.bind(this);
  }

  private getStrategyContext(
    overrides?: Partial<LLMConfigurableProps>,
  ): StrategyContext {
    const OPT_PARAMS = getOptParams();
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

    return {
      commonParams,
      prefill: this.prefill,
      chatMode: this.chatMode,
      reasoningTracker: this.reasoningTracker,
      previousReasoning: overrides?.previousReasoning,
    };
  }

  private async makeRequest(
    payload: ChatCompletionsPayload | ResponsesPayload | CompletionsPayload,
    signal: AbortSignal,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "User-Agent": `${this.appState.P_NAME}/${this.appState.P_VERSION}`,
    };

    if (this.keepAlive === false) {
      headers["Connection"] = "close";
    }

    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
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
      if (signal.aborted) {
        const reason: unknown = signal.reason;
        const message =
          reason instanceof Error ? reason.message : String(reason);

        throw createError(
          simpleTemplate(this.appState.s.e.lllm.networkErrorOpenAI, {
            URL: this.url,
          }) +
            ": " +
            message,
          { code: "TIMEOUT_ERROR", cause: err },
        );
      }

      if (
        err instanceof Error &&
        (err.name === "AbortError" || err.name === "TypeError")
      ) {
        let message = simpleTemplate(
          this.appState.s.e.lllm.networkErrorOpenAI,
          {
            URL: this.url,
          },
        );

        const cause = err.cause as { code?: string } | undefined;
        if (cause?.code) {
          message +=
            " " +
            simpleTemplate(this.appState.s.e.lllm.networkErrorReason, {
              Code: cause.code,
            });
        } else {
          message += ` (${err.message})`;
        }
        throw createError(message, { cause: err });
      }

      throw err;
    }
  }

  private async *readSSEAndParse(
    payload: ChatCompletionsPayload | ResponsesPayload | CompletionsPayload,
    ctx: StrategyContext,
    options: { idleTimeout?: boolean; signal?: AbortSignal } = {},
  ): AsyncGenerator<string, void, unknown> {
    const streamCtrl = new StreamController(this.abrtTimeout);

    const onAbort = () => streamCtrl.abort(options.signal?.reason);
    if (options.signal) {
      if (options.signal.aborted) {
        streamCtrl.abort(options.signal.reason);
      } else {
        options.signal.addEventListener("abort", onAbort);
      }
    }

    const hardTimeoutStr = this.appState.s.e.lllm.hardTimeOut;
    const idleTimeoutStr = this.appState.s.e.lllm.idleTimeOut;
    const tExceededStr = this.appState.s.e.lllm.tExceeded;

    streamCtrl.startTimer(
      options.idleTimeout ? idleTimeoutStr : hardTimeoutStr,
    );

    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let response: Response | null = null;
    let doneSignalReceived = false;

    try {
      try {
        response = await this.makeRequest(payload, streamCtrl.signal);
      } catch (err) {
        streamCtrl.clearTimer();
        throw err;
      }

      const decoder = new TextDecoder();
      let buffer = "";

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

          if (options.idleTimeout) {
            streamCtrl.startTimer(tExceededStr);
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
              if (line.startsWith(":")) continue;
              if (line.startsWith("data:")) {
                let value = line.slice(5);
                if (value.startsWith(" ")) {
                  value = value.slice(1);
                }
                eventData += (eventData ? "\n" : "") + value;
              }
            }

            if (!eventData) continue;
            if (eventData === "[DONE]") {
              doneSignalReceived = true;
              break;
            }

            try {
              const parsed = JSON.parse(eventData) as ParsedStreamChunk;
              const items = this.strategy.parseChunk(parsed, ctx);

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
          if (reader) {
            if (!doneSignalReceived) {
              await reader.cancel();
            } else {
              reader.releaseLock();
            }
          }
        } catch {
          /* ignore */
        }
        streamCtrl.clearTimer();
      }
    } catch (err) {
      try {
        if (reader) await reader.cancel(err);
      } catch {
        /* ignore */
      }
      streamCtrl.clearTimer();
      throw err;
    } finally {
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    }
  }

  protected async *inferStream(
    messages: Message[],
    options: {
      idleTimeout?: boolean;
      overrides?: Partial<LLMConfigurableProps>;
      signal?: AbortSignal;
    } = {},
  ): AsyncGenerator<string, void, unknown> {
    const ctx = this.getStrategyContext(options.overrides);
    const payload = this.strategy.buildPayload(messages, ctx);

    yield* this.readSSEAndParse(payload, ctx, {
      idleTimeout: options.idleTimeout,
      signal: options.signal,
    });
  }

  protected async infer(
    messages: Message[],
    {
      verbose = false,
      overrides,
      signal,
    }: {
      verbose?: boolean | ((chunk: string) => Promise<void>);
      overrides?: Partial<LLMConfigurableProps>;
      signal?: AbortSignal;
    } = {},
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

    for await (const chunk of this.inferStream(messages, {
      idleTimeout,
      overrides,
      signal,
    })) {
      if (typeof verbose === "function") {
        await verbose(chunk);
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
    const enc = this.reasoningTracker.encrypted;
    const unenc = this.reasoningTracker.unencrypted;
    const preferred = preferUnencrypted ? (unenc ?? enc) : (enc ?? unenc);
    return { encrypted: enc, unencrypted: unenc, preferred: preferred ?? null };
  }

  public toString(): string {
    return JSON.stringify(this, (key: string, value: unknown) => {
      if (
        key === "chunks" ||
        key === "text" ||
        key === "processedBatch" ||
        key === "appState" ||
        key === "controller" ||
        key === "strategy" ||
        key === "reasoningTracker"
      ) {
        return undefined;
      }
      if (key === "apiKey" && value && !this.appState.DEBUG_MODE) {
        return this.appState.s.m.lcli.redacted;
      }
      return value;
    });
  }
}
