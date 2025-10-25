import { DelayTuple } from ".";
export type OpenAIStreamChunk = {
  choices?: { delta?: { content?: string } }[];
};

export type backend = "openai";

export interface Message {
  role: string;
  content: string;
}

export type OpenAIPayload = {
  messages: Message[];
  stream: boolean;
  model?: string;
  temperature?: number;
  top_p?: number;
  min_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  seed?: number;
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
  temperature?: NumberParam;
  top_p?: NumberParam;
  min_p?: NumberParam;
  top_k?: NumberParam;
  repeat_penalty?: NumberParam;
  frequency_penalty?: NumberParam;
  presence_penalty?: NumberParam;
  seed?: NumberParam;
  systemPrompt?: PromptParam;
  prependPrompt?: PromptParam;
  lastIndex?: number;
  chunkSize: number;
  batchSize: number;
}

export type ConfigurablePropValue = LLMConfigurableProps[keyof LLMConfigurableProps];
export type LLMOptions = Record<string, LLMConfigurableProps>;

export type MappableParamKey = Extract<keyof LLMConfigurableProps, keyof OpenAIPayload>;
export type MappableParamValue = OpenAIPayload[MappableParamKey];

export type TerminationState = "none" | "requested" | "forceful";

export interface ProgressState extends LLMConfigurableProps {
  fileName: string;
  lastIndex: number;
}

export interface ConfigQuantFile {
  file: string;
  fileMMPROJ?: string;
  args: readonly string[];
  np: readonly string[];
}

export type ConfigQuantizationLevels = Record<string, ConfigQuantFile>;

export type ConfigQuantFiles = {
  instruct?: ConfigQuantizationLevels;
  reasoning?: ConfigQuantizationLevels;
};

interface ConfigMetadata {
  helptext_key: string;
  stripTags?: { start: string; end: string };
  /* double use: could be used to alter behavior if model is remote (set to false),
   * do not show model in helptext and only use metadata and launcher information
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
  | "min_p"
  | "repeat_penalty"
  | "frequency_penalty"
  | "presence_penalty"
  | "seed"
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
  quantFiles?: ConfigQuantizationLevels;
}

export interface ReasonOnlyModelConfig extends ModelConfigBase {
  reasoningType: "reason_only";
  default: ConfigModelVariant;
  quantFiles?: ConfigQuantizationLevels;
}

export interface ReasonAndInstructModelConfig extends ModelConfigBase {
  reasoningType: "reason_and_instruct";
  instruct: ConfigModelVariant;
  reasoning: ConfigModelVariant;
  quantFiles?: ConfigQuantFiles;
}

export type ModelConfig =
  | InstructOnlyModelConfig
  | ReasonOnlyModelConfig
  | ReasonAndInstructModelConfig;

export type ParamConfigs = Record<string, ModelConfig>;

interface AppConfigFallbackValues {
  chunkSize: string;
  batchSize: string;
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
  LLAMACPP_CMD: string;
  MODELS_LOCATION: string;
  LLAMACPP_BASE_ARGS: readonly string[];
  QUANTIZATION_ORDER: readonly string[];
  PARAM_CONFIGS: ParamConfigs;
}
