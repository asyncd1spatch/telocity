#!/usr/bin/env bun

import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import type { AppConfig } from "../src/libs/types/index.ts";

const VALID_REASONING_EFFORT_VALUES = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

const definitions = {
  stringParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "string" }],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
  },
  numberParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "number" }],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
  },
  booleanParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "boolean" }],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
  },
  objectParam: {
    type: "array",
    items: [{ type: "boolean" }, { type: "object" }],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
  },
  reasoningEffortParam: {
    type: "array",
    items: [
      { type: "boolean" },
      { type: "string", enum: [...VALID_REASONING_EFFORT_VALUES] },
    ],
    minItems: 2,
    maxItems: 2,
    additionalItems: false,
  },
  promptParam: {
    oneOf: [
      {
        type: "array",
        items: [{ type: "boolean" }, { type: "string" }],
        minItems: 2,
        maxItems: 2,
        additionalItems: false,
      },
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
        additionalItems: false,
      },
    ],
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
      display: { type: "boolean" },
    },
    required: ["helptext_key"],
    additionalProperties: false,
  },
  configModelParams: {
    type: "object",
    properties: {
      chunkSize: { type: "number", minimum: 1 },
      batchSize: { type: "number", minimum: 1 },
      parallel: { type: "number", minimum: 1 },
      url: { type: "string", format: "uri" },
      apiKey: { type: "string" },
      delay: { type: "number", minimum: 0 },
      maxAttempts: { type: "number", minimum: 1 },
      tempIncrement: { type: "number", minimum: 0 },
      timeout: { type: "number" },
      images: { type: "array", items: { type: "string" } },

      model: { $ref: "#/definitions/stringParam" },
      temperature: { $ref: "#/definitions/numberParam" },
      top_p: { $ref: "#/definitions/numberParam" },
      top_k: { $ref: "#/definitions/numberParam" },
      presence_penalty: { $ref: "#/definitions/numberParam" },
      seed: { $ref: "#/definitions/numberParam" },

      reasoning_effort: { $ref: "#/definitions/reasoningEffortParam" },
      enable_thinking: { $ref: "#/definitions/booleanParam" },
      chat_template_kwargs: { $ref: "#/definitions/objectParam" },
      reasoning: { $ref: "#/definitions/objectParam" },
    },
    additionalProperties: false,
  },
  configPrompt: {
    type: "object",
    properties: {
      defSys: { $ref: "#/definitions/promptParam" },
      defPrep: { $ref: "#/definitions/promptParam" },
      defPrefill: { $ref: "#/definitions/promptParam" },
    },
    minProperties: 1,
    additionalProperties: false,
  },
  configModelVariant: {
    type: "object",
    properties: {
      prompt: { $ref: "#/definitions/configPrompt" },
      model: { $ref: "#/definitions/configModelParams" },
    },
    required: ["model"],
    additionalProperties: false,
  },
  instructOnlyModelConfig: {
    type: "object",
    properties: {
      reasoningType: { const: "instruct_only" },
      metadata: { $ref: "#/definitions/configMetadata" },
      default: { $ref: "#/definitions/configModelVariant" },
    },
    required: ["reasoningType", "metadata", "default"],
  },
  reasonOnlyModelConfig: {
    type: "object",
    properties: {
      reasoningType: { const: "reason_only" },
      metadata: { $ref: "#/definitions/configMetadata" },
      default: { $ref: "#/definitions/configModelVariant" },
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
    },
    required: ["reasoningType", "metadata", "instruct", "reasoning"],
  },
} as const;

const appConfigSchema = {
  type: "object",
  properties: {
    DEFAULT_MODEL: { type: "string" },
    MAX_SIZE_MB: { type: "number", minimum: 0 },
    TIMEOUT: { type: "number", minimum: 0 },
    SOURCE_LANGUAGE: { type: "string" },
    TARGET_LANGUAGE: { type: "string" },
    TERMINAL_PREPEND: { type: "string" },
    DEFAULT_TF_PROMPT: { type: "string" },
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
        delay: { type: "string" },
        url: { type: "string", format: "uri" },
        apiKey: { type: "string" },
        model: { $ref: "#/definitions/stringParam" },
        temperature: { $ref: "#/definitions/numberParam" },
        top_p: { $ref: "#/definitions/numberParam" },
      },
      required: [
        "chunkSize",
        "batchSize",
        "parallel",
        "delay",
        "model",
        "url",
        "apiKey",
        "temperature",
        "top_p",
      ],
      additionalProperties: false,
    },
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
    "TIMEOUT",
    "SOURCE_LANGUAGE",
    "TARGET_LANGUAGE",
    "TERMINAL_PREPEND",
    "DEFAULT_TF_PROMPT",
    "TEMPLATES",
    "FALLBACK_VALUES",
    "PARAM_CONFIGS",
  ],
  additionalProperties: false,
  definitions,
} as const;

const ajv = new Ajv.default({
  allErrors: true,
  strict: true,
  discriminator: true,
});
addFormats.default(ajv);

const validate = ajv.compile<AppConfig>(appConfigSchema);

type ValidationResult =
  | { isValid: true; data: AppConfig }
  | { isValid: false; errors: typeof validate.errors };

function isAppConfig(data: unknown): data is AppConfig {
  return validate(data);
}

export function validateConfig(data: unknown): ValidationResult {
  if (isAppConfig(data)) {
    return {
      isValid: true,
      data,
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
    const configPath = "./data/config/template.config.json";
    const fileContent = await readFile(configPath, "utf-8");
    const configData: unknown = JSON.parse(fileContent);

    const result = validateConfig(configData);

    if (result.isValid) {
      console.log("\nConfiguration is valid!");
      console.log(`Default Model: ${result.data.DEFAULT_MODEL}`);
    } else {
      console.error("\nConfiguration is invalid. Errors:");
      console.error(JSON.stringify(result.errors, null, 2));
      process.exit(1);
    }
  } catch (err) {
    console.error(
      "An error occurred while reading or parsing the config file:",
      err,
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
