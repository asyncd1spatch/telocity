import { type DelayTuple } from "./types.ts";

export type OutputTextPart = {
  type: "output_text";
  text: string;
};

export type ReasoningTextPart = {
  type: "reasoning_text";
  text: string;
};

export type OutputContentItem = OutputTextPart | ReasoningTextPart;

export type MessageOutputItem = {
  type: "message";
  id?: string;
  role?: "assistant";
  content: OutputTextPart[];
};

export type ReasoningOutputItem = {
  type: "reasoning";
  id?: string;
  summary?: { type: "summary_text"; text: string }[];
  encrypted_content?: string | null;
  content?: ReasoningTextPart[];
};

export type FunctionCallOutputItem = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

export type FunctionCallOutputResultItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type OutputItem =
  | MessageOutputItem
  | ReasoningOutputItem
  | FunctionCallOutputItem
  | FunctionCallOutputResultItem;

export type ParsedStreamChunk = {
  type?: string;
  delta?: string;
  text?: string;
  response?: {
    output?: OutputItem[];
  };
  output?: OutputItem[];
  choices?: Array<{ delta?: { content?: string } }>;
  item?: OutputItem;
};

export type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
    text?: string; // Fallback: legacy 'text' in choices
  }>;
  output?: OutputItem[];
  response?: {
    output?: OutputItem[];
  };
  text?: string | { content?: string } | null;
  content?: string; // Fallback: 'content' at root (llama.cpp raw)
};

export type RawStreamChunk = {
  // ChatCompletions
  choices?: { delta?: { content?: string } }[];
  // Responses API
  output?: {
    type?: "message" | "reasoning";
    content?: { type: "output_text"; text: string }[];
  }[];
};

export type ImageContentPart = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "low" | "high" | "auto";
  };
};

export type TextContentPart = {
  type: "text";
  text: string;
};

export type MessageContent = string | (TextContentPart | ImageContentPart)[];

export interface Message {
  role: string;
  content: MessageContent;
}

export type ResponsesInputContentPart =
  | { type: "input_text"; text: string }
  | { type: "output_text"; text: string }
  | {
      type: "input_image";
      image_url?: string;
      image_base64?: string;
    };

export interface ResponsesMessage {
  type: "message";
  role: string;
  content: ResponsesInputContentPart[];
}

export const VALID_REASONING_EFFORT_VALUES = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ReasoningEffortValue =
  (typeof VALID_REASONING_EFFORT_VALUES)[number];

export type ResponsesPayload = {
  input: ResponsesMessage[] | string;
  instructions?: string;
  model?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  seed?: number;
  tools?: unknown[];
  store?: boolean;
  include?: string[];
  reasoning?: {
    effort?: ReasoningEffortValue;
    summary?: "auto" | boolean;
  }; // official v1/responses API
  chat_template_kwargs?: {
    reasoning_effort?: ReasoningEffortValue;
    [key: string]: unknown;
  }; // llama.cpp
};

export type ChatCompletionsPayload = {
  messages: Message[];
  stream: boolean;
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  seed?: number;
  reasoning_effort?: ReasoningEffortValue; // official v1/chat/completions
  chat_template_kwargs?: {
    reasoning_effort?: ReasoningEffortValue;
    [key: string]: unknown;
  }; // llama.cpp
};

export type CompletionsPayload = {
  prompt: string;
  stream: boolean;
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  seed?: number;
  reasoning_effort?: ReasoningEffortValue;
  chat_template_kwargs?: {
    reasoning_effort?: ReasoningEffortValue;
    [key: string]: unknown;
  };
};

export type ConfigParam<T> = readonly [enabled: boolean, value: T];

export type PromptParam =
  | ConfigParam<string>
  | readonly [
      enabled: boolean,
      value: string,
      role: string,
      another_flag: boolean,
    ];

export type StringParam = ConfigParam<string>;
export type NumberParam = ConfigParam<number>;

export interface LLMConfigurableProps {
  url?: string;
  apiKey?: string;
  delay?: DelayTuple;
  model?: StringParam;
  images?: string[];
  temperature?: NumberParam;
  top_p?: NumberParam;
  top_k?: NumberParam;
  presence_penalty?: NumberParam;
  seed?: NumberParam;
  timeout?: NumberParam;
  reasoning_effort?: ConfigParam<ReasoningEffortValue>;
  chat_template_kwargs?: ConfigParam<{
    reasoning_effort: ReasoningEffortValue;
  }>;
  reasoning?: ConfigParam<{ effort: ReasoningEffortValue }>;
  systemPrompt?: PromptParam;
  prependPrompt?: PromptParam;
  prefill?: PromptParam;
  lastIndex?: number;
  chunkSize: number;
  batchSize: number;
  parallel: number;
  chatMode?: boolean;
  keepAlive?: boolean;
}

export type MappableParamKey = Extract<
  keyof LLMConfigurableProps,
  keyof ChatCompletionsPayload | keyof ResponsesPayload
>;

export type MappableParamValue =
  | ChatCompletionsPayload[keyof ChatCompletionsPayload]
  | ResponsesPayload[keyof ResponsesPayload]
  | CompletionsPayload[keyof CompletionsPayload];

export type TerminationState = "none" | "requested" | "forceful";

export interface ProgressState extends LLMConfigurableProps {
  fileName: string;
  lastIndex: number;
}

interface ConfigMetadata {
  helptext_key: string;
  stripTags?: { start: string; end: string };
  display?: boolean;
}

type ConfigModelParams = Pick<
  LLMConfigurableProps,
  | "chunkSize"
  | "batchSize"
  | "parallel"
  | "url"
  | "delay"
  | "model"
  | "temperature"
  | "top_p"
  | "top_k"
  | "presence_penalty"
  | "seed"
  | "timeout"
  | "reasoning_effort"
  | "chat_template_kwargs"
  | "reasoning"
>;

export interface ConfigPrompt {
  defSys: PromptParam;
  defPrep: PromptParam;
  defPrefill: PromptParam;
}

export interface ConfigModelVariant {
  prompt: ConfigPrompt;
  model: Partial<ConfigModelParams>;
}

interface ModelConfigBase {
  reasoningType: "reason_and_instruct" | "instruct_only" | "reason_only";
  metadata: ConfigMetadata;
}

export interface InstructOnlyModelConfig extends ModelConfigBase {
  reasoningType: "instruct_only";
  default: ConfigModelVariant;
}

export interface ReasonOnlyModelConfig extends ModelConfigBase {
  reasoningType: "reason_only";
  default: ConfigModelVariant;
}

export interface ReasonAndInstructModelConfig extends ModelConfigBase {
  reasoningType: "reason_and_instruct";
  instruct: ConfigModelVariant;
  reasoning: ConfigModelVariant;
}

export type ModelConfig =
  | InstructOnlyModelConfig
  | ReasonOnlyModelConfig
  | ReasonAndInstructModelConfig;

export type ParamConfigs = Record<string, ModelConfig>;

interface AppConfigFallbackValues {
  chunkSize: string;
  batchSize: string;
  parallel: string;
  model: StringParam;
  url: string;
  apiKey: string;
  temperature: NumberParam;
  top_p: NumberParam;
}

export interface AppConfig {
  DEFAULT_MODEL: string;
  MAX_SIZE_MB: number;
  TIMEOUT: number;
  SOURCE_LANGUAGE: string;
  TARGET_LANGUAGE: string;
  TERMINAL_PREPEND: string;
  DEFAULT_TF_PROMPT: string;
  EMPTY_FIELD: readonly [false, "", "", false];
  TEMPLATES?: Record<string, string>;
  FALLBACK_VALUES: AppConfigFallbackValues;
  PARAM_CONFIGS: ParamConfigs;
}
