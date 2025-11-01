import Ajv from "ajv";
import addFormats from "ajv-formats";
import path from "node:path";
import { AppConfig } from "../src/libs/types";

const definitions = {
  stringParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "string" }],
    minItems: 2,
    maxItems: 2,
  },
  numberParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "number" }],
    minItems: 2,
    maxItems: 2,
  },
  promptParam: {
    oneOf: [
      {
        type: "array",
        items: [
          { type: "boolean" },
          { type: "string" },
          { type: "string" },
          { type: "boolean" },
        ],
        minItems: 4,
        maxItems: 4,
      },
      { $ref: "#/definitions/stringParam" },
    ],
  },
  configQuantFile: {
    type: "object",
    properties: {
      file: { type: "string" },
      fileMMPROJ: { type: "string" },
      args: { type: "array", items: { type: "string" } },
      np: { type: "array", items: { type: "string" } },
    },
    required: ["file", "args", "np"],
    additionalProperties: false,
  },
  configQuantizationLevels: {
    type: "object",
    patternProperties: {
      "^.+$": { $ref: "#/definitions/configQuantFile" },
    },
    additionalProperties: false,
  },
  configQuantFiles: {
    type: "object",
    properties: {
      instruct: { $ref: "#/definitions/configQuantizationLevels" },
      reasoning: { $ref: "#/definitions/configQuantizationLevels" },
    },
    additionalProperties: false,
  },
  configMetadata: {
    type: "object",
    properties: {
      helptext_key: { type: "string" },
      stripTags: {
        type: "object",
        properties: {
          start: { type: "string" },
          end: { type: "string" },
        },
        required: ["start", "end"],
        additionalProperties: false,
      },
      localPreset: { type: "boolean" },
    },
    required: ["helptext_key"],
    additionalProperties: false,
  },
  configModelParams: {
    type: "object",
    properties: {
      llmbackend: { type: "string", enum: ["openai"] },
      url: { type: "string", format: "uri" },
      apiKey: { type: "string" },
      delay: { $ref: "#/definitions/numberParam" },
      model: { $ref: "#/definitions/stringParam" },
      temperature: { $ref: "#/definitions/numberParam" },
      top_p: { $ref: "#/definitions/numberParam" },
      min_p: { $ref: "#/definitions/numberParam" },
      top_k: { $ref: "#/definitions/numberParam" },
      repeat_penalty: { $ref: "#/definitions/numberParam" },
      frequency_penalty: { $ref: "#/definitions/numberParam" },
      presence_penalty: { $ref: "#/definitions/numberParam" },
      seed: { $ref: "#/definitions/numberParam" },
    },
    additionalProperties: false,
  },
  configPrompt: {
    type: "object",
    properties: {
      defSys: { $ref: "#/definitions/promptParam" },
      defPrep: { $ref: "#/definitions/promptParam" },
    },
    required: ["defSys", "defPrep"],
    additionalProperties: false,
  },
  configModelVariant: {
    type: "object",
    properties: {
      prompt: { $ref: "#/definitions/configPrompt" },
      model: { $ref: "#/definitions/configModelParams" },
    },
    required: ["prompt", "model"],
    additionalProperties: false,
  },
  instructOnlyModelConfig: {
    type: "object",
    properties: {
      reasoningType: { const: "instruct_only" },
      metadata: { $ref: "#/definitions/configMetadata" },
      default: { $ref: "#/definitions/configModelVariant" },
      quantFiles: { $ref: "#/definitions/configQuantizationLevels" },
    },
    required: ["reasoningType", "metadata"],
  },
  reasonOnlyModelConfig: {
    type: "object",
    properties: {
      reasoningType: { const: "reason_only" },
      metadata: { $ref: "#/definitions/configMetadata" },
      default: { $ref: "#/definitions/configModelVariant" },
      quantFiles: { $ref: "#/definitions/configQuantizationLevels" },
    },
    required: ["reasoningType", "metadata", "default"],
  },
  reasonAndInstructModelConfig: {
    type: "object",
    properties: {
      reasoningType: { const: "reason_and_instruct" },
      metadata: { $ref: "#/definitions/configMetadata" },
      instruct: { $ref: "#/definitions/configModelVariant" },
      reasoning: { $ref: "#/definitions/configModelVariant" },
      quantFiles: { $ref: "#/definitions/configQuantFiles" },
    },
    required: ["reasoningType", "metadata", "instruct", "reasoning"],
  },
} as const;

const appConfigSchema = {
  type: "object",
  properties: {
    DEFAULT_MODEL: { type: "string" },
    MAX_SIZE_MB: { type: "number", minimum: 0 },
    HUMAN_TIMEOUT: { type: "number", minimum: 0 },
    SOURCE_LANGUAGE: { type: "string" },
    TARGET_LANGUAGE: { type: "string" },
    TERMINAL_PREPEND: { type: "string" },
    DEFAULT_TF_PROMPT: { type: "string" },
    EMPTY_FIELD: {
      type: "array",
      items: [
        { const: false },
        { const: "" },
        { const: "" },
        { const: false },
      ],
      minItems: 4,
      maxItems: 4,
    },
    TEMPLATES: {
      type: "object",
      patternProperties: {
        "^.+$": { type: "string" },
      },
    },
    FALLBACK_VALUES: {
      type: "object",
      properties: {
        chunkSize: { type: "string", pattern: "^[0-9]+$" },
        batchSize: { type: "string", pattern: "^[0-9]+$" },
        parallel: { type: "string", pattern: "^[0-9]+$" },
        model: { $ref: "#/definitions/stringParam" },
        url: { type: "string", format: "uri" },
        apiKey: { type: "string" },
        temperature: { $ref: "#/definitions/numberParam" },
        top_p: { $ref: "#/definitions/numberParam" },
      },
      required: [
        "chunkSize",
        "batchSize",
        "parallel",
        "model",
        "url",
        "apiKey",
        "temperature",
        "top_p",
      ],
      additionalProperties: false,
    },
    LLAMACPP_CMD: { type: "string" },
    MODELS_LOCATION: { type: "string" },
    LLAMACPP_BASE_ARGS: { type: "array", items: { type: "string" } },
    QUANTIZATION_ORDER: { type: "array", items: { type: "string" } },
    PARAM_CONFIGS: {
      type: "object",
      patternProperties: {
        "^.+$": {
          type: "object",
          oneOf: [
            { $ref: "#/definitions/instructOnlyModelConfig" },
            { $ref: "#/definitions/reasonOnlyModelConfig" },
            { $ref: "#/definitions/reasonAndInstructModelConfig" },
          ],
          discriminator: { propertyName: "reasoningType" },
        },
      },
      additionalProperties: false,
    },
  },
  required: [
    "DEFAULT_MODEL",
    "MAX_SIZE_MB",
    "HUMAN_TIMEOUT",
    "SOURCE_LANGUAGE",
    "TARGET_LANGUAGE",
    "TERMINAL_PREPEND",
    "DEFAULT_TF_PROMPT",
    "EMPTY_FIELD",
    "FALLBACK_VALUES",
    "LLAMACPP_CMD",
    "MODELS_LOCATION",
    "LLAMACPP_BASE_ARGS",
    "QUANTIZATION_ORDER",
    "PARAM_CONFIGS",
  ],
  additionalProperties: false,
  definitions,
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: true,
  discriminator: true,
});
addFormats(ajv);

const validate = ajv.compile<AppConfig>(appConfigSchema);

type ValidationResult =
  | { isValid: true; data: AppConfig }
  | { isValid: false; errors: typeof validate.errors };

export function validateConfig(data: unknown): ValidationResult {
  if (validate(data)) {
    return {
      isValid: true,
      data: data as AppConfig,
    };
  }
  return {
    isValid: false,
    errors: validate.errors,
  };
}

async function main() {
  console.log("Attempting to validate 'config.json'...");

  try {
    const fileContent = await Bun.file(path.resolve("./data/config/template.config.json")).text();
    const configData = JSON.parse(fileContent);

    const result = validateConfig(configData);

    if (result.isValid) {
      console.log("\n✅ Configuration is valid!");
      console.log(`Default Model: ${result.data.DEFAULT_MODEL}`);
    } else {
      console.error("\n❌ Configuration is invalid. Errors:");
      console.error(JSON.stringify(result.errors, null, 2));
    }
  } catch (err) {
    console.error("An error occurred while reading or parsing the config file:", err);
  }
}

await main();
