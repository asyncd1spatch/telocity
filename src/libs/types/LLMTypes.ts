import { type DelayTuple } from "./types.ts";
export type OpenAIStreamChunk = {
  choices?: { delta?: { content?: string } }[];
};

export type backend = "chatcompletions";

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

export type OpenAIPayload = {
  messages: Message[];
  stream: boolean;
  model?: string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  seed?: number;
  chat_template_kwargs?: Record<string, string>;
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
  llmbackend?: backend;
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
  systemPrompt?: PromptParam;
  prependPrompt?: PromptParam;
  chat_template_kwargs?: ConfigParam<Record<string, string>>;
  lastIndex?: number;
  chunkSize: number;
  batchSize: number;
  parallel: number;
}

export type ConfigurablePropValue =
  LLMConfigurableProps[keyof LLMConfigurableProps];
export type LLMOptions = Record<string, LLMConfigurableProps>;

export type MappableParamKey = Extract<
  keyof LLMConfigurableProps,
  keyof OpenAIPayload
>;
export type MappableParamValue = OpenAIPayload[MappableParamKey];

export type TerminationState = "none" | "requested" | "forceful";

export interface ProgressState extends LLMConfigurableProps {
  fileName: string;
  lastIndex: number;
}

interface ConfigMetadata {
  helptext_key: string;
  stripTags?: { start: string; end: string };
  /* double use: could be used to alter behavior if model is remote (set to false),
   * do not show model in helptext and only use metadata information
   * if undefined */
  localPreset: boolean;
}

type ConfigModelParams = Pick<
  LLMConfigurableProps,
  | "llmbackend"
  | "url"
  | "delay"
  | "model"
  | "temperature"
  | "top_p"
  | "top_k"
  | "presence_penalty"
  | "seed"
  | "chat_template_kwargs"
>;

export interface ConfigPrompt {
  defSys: PromptParam;
  defPrep: PromptParam;
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
  HUMAN_TIMEOUT: number;
  SOURCE_LANGUAGE: string;
  TARGET_LANGUAGE: string;
  TERMINAL_PREPEND: string;
  DEFAULT_TF_PROMPT: string;
  EMPTY_FIELD: readonly [false, "", "", false];
  TEMPLATES?: Record<string, string>;
  FALLBACK_VALUES: AppConfigFallbackValues;
  PARAM_CONFIGS: ParamConfigs;
}

export interface ChatMessage extends Message {
  tokens: number;
}

export interface ChatSessionMetadata {
  createdAt: string;
  updatedAt: string;
  paramsKey: string;
  sessionType?: "instruct" | "reasoning";
  modelName?: string;
  tokenizerName: string;
  contextLimit: number;
  url: string;
  apiKey: string;
}

export interface ChatSession {
  metadata: ChatSessionMetadata;
  messages: ChatMessage[];
}
