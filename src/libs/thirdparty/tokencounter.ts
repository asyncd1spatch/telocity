import { serialize } from "bun:jsc";
import { cpus } from "node:os";
import path from "node:path";
import { AppStateSingleton, createError, errlog, runConcur } from "../core";
import type { TokenizerConfig, TokenizerJSON } from "./tokenizertypes";

async function loadTokenizerData(
  tokenizerName: string,
): Promise<[TokenizerJSON, TokenizerConfig] | null> {
  const appState = AppStateSingleton.getInstance();
  const modelsDir = path.join(appState.STATE_DIR, "models");

  const tokenizerJsonPath = path.join(modelsDir, `${tokenizerName}.json`);
  const tokenizerConfigPath = path.join(modelsDir, `${tokenizerName}_config.json`);

  try {
    const tokenizerJson: TokenizerJSON = await Bun.file(tokenizerJsonPath).json();
    const tokenizerConfig: TokenizerConfig = await Bun.file(tokenizerConfigPath).json();

    return [tokenizerJson, tokenizerConfig];
  } catch (err) {
    errlog(
      { level: "error" },
      `Failed to load tokenizer data for "${tokenizerName}". Ensure '${tokenizerJsonPath}' and '${tokenizerConfigPath}' exist and are valid JSON files. Error: ${err}`,
    );
    return null;
  }
}

let sharedBufferCache:
  | Map<
    string,
    {
      sharedTokenizerBuffer: SharedArrayBuffer;
      sharedConfigBuffer: SharedArrayBuffer;
    }
  >
  | undefined;

async function getSerializedSharedBuffers(tokenizerName: string) {
  if (sharedBufferCache === undefined) {
    sharedBufferCache = new Map();
  }

  const cacheKey = `${tokenizerName}_serialized_shared`;
  const cachedBuffers = sharedBufferCache.get(cacheKey);
  if (cachedBuffers) return cachedBuffers;

  const loadedData = await loadTokenizerData(tokenizerName);

  if (!loadedData) {
    throw createError(`Failed to load tokenizer files for ${tokenizerName}`, { code: "TOKENIZER_NOT_FOUND" });
  }
  const [tokenizerJSON, tokenizerConfig] = loadedData;

  const serializedTokenizer = serialize(tokenizerJSON);
  const serializedConfig = serialize(tokenizerConfig);

  const sharedTokenizerBuffer = new SharedArrayBuffer(
    serializedTokenizer.byteLength,
  );
  new Uint8Array(sharedTokenizerBuffer).set(new Uint8Array(serializedTokenizer));

  const sharedConfigBuffer = new SharedArrayBuffer(serializedConfig.byteLength);
  new Uint8Array(sharedConfigBuffer).set(new Uint8Array(serializedConfig));

  const buffers = { sharedTokenizerBuffer, sharedConfigBuffer };
  sharedBufferCache.set(cacheKey, buffers);
  return buffers;
}

interface ParallelCountInput {
  text: string;
  text_pair?: string | null;
  options?: { add_special_tokens?: boolean };
}

export async function countTokensInParallel(
  tokenizerName: string,
  inputs: ParallelCountInput[],
  options: { numWorkers?: number } = {},
): Promise<number[]> {
  if (inputs.length === 0) return [];
  const { sharedTokenizerBuffer, sharedConfigBuffer } = await getSerializedSharedBuffers(tokenizerName);

  const numWorkers = options.numWorkers
    ? Math.min(options.numWorkers, inputs.length)
    : Math.min(cpus().length, inputs.length);
  const chunkSize = Math.ceil(inputs.length / numWorkers);
  const chunks = Array.from({ length: numWorkers }, (_, i) => inputs.slice(i * chunkSize, (i + 1) * chunkSize));

  const workerPromises = chunks
    .filter((chunk) => chunk.length > 0)
    .map(
      (chunk): () => Promise<number[]> => {
        return () => {
          const devWorkerPath = new URL("../../../tokenworker.ts", import.meta.url);
          const compiledWorkerPath = "./tokenworker.ts";

          const workerUrl = typeof __IS_COMPILED__ !== "undefined" && __IS_COMPILED__
            ? compiledWorkerPath
            : devWorkerPath;
          const worker = new Worker(workerUrl);

          const workerPayload = {
            sharedTokenizerBuffer,
            sharedConfigBuffer,
            inputs: chunk,
          };

          const promise = new Promise<number[]>((resolve, reject) => {
            worker.onmessage = (event: MessageEvent<number[]>) => resolve(event.data);
            worker.onerror = (event: ErrorEvent) => {
              event.preventDefault();
              reject(event.error || new Error(event.message));
            };
            worker.addEventListener("close", (event: Event) => {
              const code = (event as CloseEvent).code;
              if (code && code !== 0) {
                reject(new Error(`Worker stopped with non-zero exit code: ${code}`));
              }
            });
          });

          worker.postMessage(workerPayload);

          return promise.finally(() => worker.terminate());
        };
      },
    );

  const results = await runConcur(workerPromises, { concurrency: 16 });

  return results.flat();
}

export async function countTokens(
  tokenizerName: string,
  textToTokenize: string,
  options: { text_pair?: string | null; add_special_tokens?: boolean } = {},
): Promise<number> {
  const input: ParallelCountInput = {
    text: textToTokenize,
    text_pair: options.text_pair,
    options: { add_special_tokens: options.add_special_tokens },
  };

  const results = await countTokensInParallel(tokenizerName, [input], {
    numWorkers: 1,
  });
  return results[0] ?? 0;
}
