import { AppStateSingleton, formatAlignedList } from "../core/index.ts";
import type {
  LanguageStrings,
  LLMConfigurableProps,
  MappableParamKey,
  MappableParamValue,
  Message,
  ModelConfig,
  OpenAIPayload,
  ParamConfigs,
} from "../types/index.ts";
import { getOptParams, LLM } from "./LLM.ts";

export function segmentText(text: string, chunkSize: number): string[] {
  const lines = text.split("\n");
  return Array.from({ length: Math.ceil(lines.length / chunkSize) }, (_, i) => {
    const start = i * chunkSize;
    const end = start + chunkSize;
    return lines.slice(start, end).join("\n");
  });
}

export function calcAvgLineLength(text: string): number {
  const lines = text.split("\n").filter((line) => line.trim() !== "");

  if (!lines.length) return 0;
  const segmenter = AppStateSingleton.getInstance().segmenter;
  const totalGraphemes = lines.reduce((sum, line) => {
    const graphemeCount = [...segmenter.segment(line)].length;
    return sum + graphemeCount;
  }, 0);
  return Math.round(totalGraphemes / lines.length);
}

export function calcAvgLineLengthBytes(text: string): number {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (!lines.length) return 0;
  const totalUTF8Bytes = lines.reduce((sum, line) => {
    const byteLength = Buffer.byteLength(line, "utf8");
    return sum + byteLength;
  }, 0);
  return Math.round(totalUTF8Bytes / lines.length);
}

export function stripGarbageNewLines(
  text: string | string[],
  stripEmpty = false,
): string {
  const appState = AppStateSingleton.getInstance();
  if (!Array.isArray(text) && typeof text !== "string") {
    const err = new TypeError(appState.s.e.lllm.stripNewLinesTypeError);
    throw err;
  }

  const lines = Array.isArray(text) ? text : text.split(/\r\n|\r|\n/);

  const result = lines.reduce((acc: string[], line) => {
    const cleaned = line.replace(/\u2028|\u2029/g, "");

    if (stripEmpty && cleaned.trim() === "") {
      return acc;
    }

    acc.push(cleaned);
    return acc;
  }, []);

  if (stripEmpty) {
    while (result.length && result[0]?.trim() === "") result.shift();
    while (result.length && result[result.length - 1]?.trim() === "") {
      result.pop();
    }
  }

  return result.join("\n");
}

export async function dummy(
  this: LLM,
  messages: Message[],
  options?: { verbose?: boolean | ((chunk: string) => void) },
): Promise<string> {
  const llmInstance = this as LLMConfigurableProps & LLM;

  function* dummyStream(): Generator<string, void, unknown> {
    const payload: OpenAIPayload = { messages, stream: true };
    const OPT_PARAMS = getOptParams();
    for (const k of OPT_PARAMS) {
      const prop = llmInstance[k];
      if (Array.isArray(prop) && prop[0]) {
        (payload as Record<MappableParamKey, MappableParamValue>)[k] = prop[1];
      }
    }

    const summaryLines = [
      "--- Dummy LLM Call (Debug Mode) ---",
      `Timestamp: ${new Date().toISOString()}`,
      `URL: ${llmInstance.url ?? "N/A"}`,
      `API Key: ${llmInstance.apiKey ? "[PRESENT]" : "[NOT PRESENT]"}`,
      `LLM Backend: ${llmInstance.llmbackend ?? "chatcompletions"}`,
      `Pre-call Delay: ${String(llmInstance.delay ?? "N/A")} ms`,
      "--- Final Payload ---",
      `Model: ${payload.model ?? "Default"}`,
    ];

    for (const param of OPT_PARAMS) {
      if (payload[param as keyof OpenAIPayload] !== undefined) {
        const value = payload[param as keyof OpenAIPayload];
        const formattedValue =
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === undefined
            ? String(value)
            : JSON.stringify(value);
        summaryLines.push(`${param}: ${formattedValue}`);
      }
    }

    summaryLines.push("\n--- Messages Payload ---");
    summaryLines.push(JSON.stringify(messages, null, 2));
    summaryLines.push("\n--- End Dummy Call ---");

    for (const line of summaryLines) {
      yield line + "\n";
      //await new Promise((resolve) => setTimeout(resolve, 666));
    }
  }

  const { verbose = false } = options ?? {};
  let result = "";

  for (const chunk of dummyStream()) {
    if (typeof verbose === "function") {
      verbose(chunk);
    } else if (verbose) {
      process.stdout.write(chunk);
    }
    result += chunk;
  }

  return Promise.resolve(result);
}

type PathString<T> = {
  [K in keyof T & string]: T[K] extends object
    ? `${K}` | `${K}.${PathString<T[K]>}`
    : `${K}`;
}[keyof T & string];

export function resolveStringKey<T>(
  obj: T,
  path: PathString<T>,
): string | undefined {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj) as string | undefined;
}

function processPresets(
  configs: ParamConfigs,
  processor: (modelConfig: ModelConfig) => string | null,
): string {
  const items = Object.entries(configs)
    .map(([key, modelConfig]) => {
      const description = processor(modelConfig);
      if (description !== null) {
        return { key, description };
      }
      return null;
    })
    .filter(
      (item): item is { key: string; description: string } => item !== null,
    );

  return formatAlignedList(items, { listIndentWidth: 2 });
}

export function getPresetHelpText(configs: ParamConfigs): string {
  const appState = AppStateSingleton.getInstance();

  return processPresets(configs, (modelConfig) => {
    const metadata = modelConfig.metadata;
    const helptextKey = metadata?.helptext_key;
    const localPreset = metadata?.localPreset;

    if (localPreset === undefined) {
      return null;
    }

    if (helptextKey) {
      const fullPath = `m.c.${helptextKey}`;
      return (
        resolveStringKey(appState.s, fullPath as PathString<LanguageStrings>) ??
        appState.s.m.c.models.noHelp
      );
    }

    return appState.s.m.c.models.noHelp;
  });
}

export function getThinkTags(configs: ParamConfigs): string {
  const appState = AppStateSingleton.getInstance();
  return processPresets(configs, (modelConfig) => {
    const stripTags = modelConfig.metadata?.stripTags;
    if (stripTags?.start && stripTags?.end) {
      return `${appState.s.m.lllm.openingTag}: '${stripTags.start}' ${appState.s.m.lllm.closingTag}: '${stripTags.end}'`;
    }
    return null;
  });
}

export function buildSystemTranslationInstruction(
  baseTemplate: string,
  sourceLanguage: string,
  targetLanguage: string,
) {
  return baseTemplate
    .replace(/{{ \.LanguageSource }}/g, sourceLanguage)
    .replace(/{{ \.LanguageTarget }}/g, targetLanguage)
    .trim();
}
