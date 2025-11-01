import Ajv from "ajv";
import path from "node:path";
import { LanguageStrings } from "../src/libs/types";

const definitions = {
  stringOrNestedObject: {
    oneOf: [
      { type: "string" },
      {
        type: "object",
        patternProperties: {
          "^.+$": { $ref: "#/definitions/stringOrNestedObject" },
        },
        additionalProperties: false,
      },
    ],
  },
  stringObject: {
    type: "object",
    patternProperties: {
      "^.+$": { type: "string" },
    },
    additionalProperties: false,
  },
  helpCommand: {
    type: "object",
    properties: {
      usage: { type: "string" },
      description: { type: "string" },
      flags: { $ref: "#/definitions/stringObject" },
      footer: { type: "string" },
    },
    required: ["usage", "description"],
    additionalProperties: false,
  },
} as const;

const i18nSchema = {
  type: "object",
  properties: {
    m: { $ref: "#/definitions/stringOrNestedObject" },
    e: { $ref: "#/definitions/stringOrNestedObject" },
    help: {
      type: "object",
      properties: {
        generic: {
          type: "object",
          properties: {
            header: { type: "string" },
            usage: { type: "string" },
            commandHeader: { type: "string" },
            commandDescriptions: { $ref: "#/definitions/stringObject" },
            footer: { type: "string" },
            globalOptionsHeader: { type: "string" },
            flags: { $ref: "#/definitions/stringObject" },
          },
          required: [
            "header",
            "usage",
            "commandHeader",
            "commandDescriptions",
            "footer",
            "globalOptionsHeader",
            "flags",
          ],
          additionalProperties: false,
        },
        commands: {
          type: "object",
          patternProperties: {
            "^.+$": { $ref: "#/definitions/helpCommand" },
          },
          additionalProperties: false,
        },
      },
      required: ["generic", "commands"],
      additionalProperties: false,
    },
  },
  required: ["m", "e", "help"],
  additionalProperties: false,
  definitions,
} as const;

const ajv = new Ajv({
  allErrors: true,
  strict: true,
});

const validate = ajv.compile<LanguageStrings>(i18nSchema);

type ValidationResult =
  | { isValid: true; data: LanguageStrings }
  | { isValid: false; errors: typeof validate.errors };

export function validateI18nFile(data: unknown): ValidationResult {
  if (validate(data)) {
    return {
      isValid: true,
      data: data as LanguageStrings,
    };
  }
  return {
    isValid: false,
    errors: validate.errors,
  };
}

async function main() {
  console.log("Attempting to validate 'en-US.json'...");

  try {
    const fileContent = await Bun.file(path.resolve("./data/i18n/en-US.json")).text();
    const i18nData = JSON.parse(fileContent);

    const result = validateI18nFile(i18nData);

    if (result.isValid) {
      console.log("\n✅ i18n file is valid!");
      console.log(`Found top-level keys: ${Object.keys(result.data).join(", ")}`);
    } else {
      console.error("\n❌ i18n file is invalid. Errors:");
      console.error(JSON.stringify(result.errors, null, 2));
    }
  } catch (error) {
    console.error("An error occurred while reading or parsing the i18n file:", error);
  }
}

await main();
