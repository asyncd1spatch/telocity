import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import {
  AppStateSingleton,
  createError,
  errlog,
  isEnoentError,
  simpleTemplate,
} from "../core/index.ts";
import type { TokenizerConfig, TokenizerJSON } from "./tokenizertypes.ts";

const workerUrl = new URL("./worker/tokenworker.js", import.meta.url);

async function loadTokenizerData(
  tokenizerName: string,
): Promise<[TokenizerJSON, TokenizerConfig] | null> {
  const appState = AppStateSingleton.getInstance();
  const modelsDir = path.join(appState.STATE_DIR, "models");

  const tokenizerJsonPath = path.join(modelsDir, `${tokenizerName}.json`);
  const tokenizerConfigPath = path.join(
    modelsDir,
    `${tokenizerName}_config.json`,
  );

  try {
    const [tokenizerJsonStr, tokenizerConfigStr] = await Promise.all([
      readFile(tokenizerJsonPath, "utf-8"),
      readFile(tokenizerConfigPath, "utf-8"),
    ]);

    return [JSON.parse(tokenizerJsonStr), JSON.parse(tokenizerConfigStr)];
  } catch (err) {
    if (isEnoentError(err)) {
      throw createError(
        simpleTemplate(appState.s.e.c.tc.tokenizerFilesNotFound, {
          TokenizerName: tokenizerName,
          JsonPath: tokenizerJsonPath,
          ConfigPath: tokenizerConfigPath,
        }),
        { code: "ENOENT", cause: err },
      );
    }
    throw err;
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
  const appState = AppStateSingleton.getInstance();
  if (sharedBufferCache === undefined) {
    sharedBufferCache = new Map();
  }

  const cacheKey = `${tokenizerName}_serialized_shared`;
  const cachedBuffers = sharedBufferCache.get(cacheKey);
  if (cachedBuffers) return cachedBuffers;

  const loadedData = await loadTokenizerData(tokenizerName);

  if (!loadedData) {
    throw createError(
      simpleTemplate(appState.s.e.c.tc.tokenizerFilesNotFound, {
        TokenizerName: tokenizerName,
      }),
      { code: "TOKENIZER_NOT_FOUND" },
    );
  }
  const [tokenizerJSON, tokenizerConfig] = loadedData;

  const encoder = new TextEncoder();

  const tokenizerBytes = encoder.encode(JSON.stringify(tokenizerJSON));
  const configBytes = encoder.encode(JSON.stringify(tokenizerConfig));

  const sharedTokenizerBuffer = new SharedArrayBuffer(
    tokenizerBytes.byteLength,
  );
  new Uint8Array(sharedTokenizerBuffer).set(tokenizerBytes);

  const sharedConfigBuffer = new SharedArrayBuffer(configBytes.byteLength);
  new Uint8Array(sharedConfigBuffer).set(configBytes);

  const buffers = { sharedTokenizerBuffer, sharedConfigBuffer };
  sharedBufferCache.set(cacheKey, buffers);
  return buffers;
}

interface ParallelCountInput {
  text: string;
  text_pair?: string | null;
  options?: { add_special_tokens?: boolean };
}

interface WorkerPayload {
  tokenizerName: string;
  sharedTokenizerBuffer: SharedArrayBuffer;
  sharedConfigBuffer: SharedArrayBuffer;
  inputs: ParallelCountInput[];
}

interface WorkerJob extends WorkerPayload {
  jobId: number;
}

interface WorkerSuccessResponse {
  jobId: number;
  results: number[];
}

interface WorkerErrorResponse {
  jobId: number;
  error: { message: string; stack?: string };
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

class TokenWorkerPool {
  private static instance: TokenWorkerPool;
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskCallbacks = new Map<
    number,
    { resolve: (value: number[]) => void; reject: (reason?: unknown) => void }
  >();
  private requestQueue: Array<{
    resolve: (worker: Worker) => void;
    reject: (reason?: unknown) => void;
  }> = [];
  private nextJobId = 0;
  private isInitialized = false;
  private isShuttingDown = false;
  private poolSize: number;

  private constructor(poolSize: number) {
    this.poolSize = poolSize;
  }

  public static getInstance(): TokenWorkerPool {
    if (!TokenWorkerPool.instance) {
      TokenWorkerPool.instance = new TokenWorkerPool(cpus().length);
    }
    return TokenWorkerPool.instance;
  }

  public initialize() {
    if (this.isInitialized || this.isShuttingDown) {
      return;
    }
    this.isInitialized = true;

    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(workerUrl);

      worker.on("message", (data: WorkerResponse) => {
        const { jobId } = data;
        const callbacks = this.taskCallbacks.get(jobId);
        if (callbacks) {
          if ("results" in data) {
            callbacks.resolve(data.results);
          } else {
            const error = new Error(data.error.message);
            error.stack = data.error.stack;
            callbacks.reject(error);
          }
          this.taskCallbacks.delete(jobId);
          this.releaseWorker(worker);
        }
      });

      worker.on("error", (err) => {
        const appState = AppStateSingleton.getInstance();
        const errorMessage = err instanceof Error ? err.message : String(err);
        errlog(
          { level: "error" },
          simpleTemplate(appState.s.e.c.tc.unhandledWorkerError, {
            Message: errorMessage,
          }),
        );
        this.removeWorker(worker);
      });

      this.workers.push(worker);
      this.idleWorkers.push(worker);
    }
  }

  private acquireWorker(): Promise<Worker> {
    if (this.isShuttingDown) {
      const appState = AppStateSingleton.getInstance();
      return Promise.reject(
        createError(appState.s.e.c.tc.poolShuttingDown, {
          immediateExitCode: false,
        }),
      );
    }

    if (this.idleWorkers.length > 0) {
      return Promise.resolve(this.idleWorkers.pop()!);
    }

    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject });
    });
  }

  private releaseWorker(worker: Worker) {
    if (this.isShuttingDown) {
      void worker.terminate();
      return;
    }

    if (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift()!;
      request.resolve(worker);
    } else {
      this.idleWorkers.push(worker);
    }
  }

  private removeWorker(worker: Worker) {
    const appState = AppStateSingleton.getInstance();
    void worker.terminate();
    this.workers = this.workers.filter((w) => w !== worker);
    this.idleWorkers = this.idleWorkers.filter((w) => w !== worker);
    errlog(
      { level: "warn" },
      simpleTemplate(appState.s.m.c.tc.removedFailedWorker, {
        PoolSize: this.workers.length,
      }),
    );
  }

  public async runJob(payload: WorkerPayload): Promise<number[]> {
    const worker = await this.acquireWorker();
    const jobId = this.nextJobId++;

    const jobPromise = new Promise<number[]>((resolve, reject) => {
      this.taskCallbacks.set(jobId, { resolve, reject });
    });

    const job: WorkerJob = { ...payload, jobId };
    worker.postMessage(job);

    return jobPromise;
  }

  public shutdown() {
    this.isShuttingDown = true;
    const appState = AppStateSingleton.getInstance();

    const shutdownError = createError(appState.s.e.c.tc.poolShuttingDown, {
      immediateExitCode: false,
    });

    for (const request of this.requestQueue) {
      request.reject(shutdownError);
    }
    this.requestQueue = [];

    for (const [jobId, callbacks] of this.taskCallbacks.entries()) {
      const jobCancelledError = createError(
        simpleTemplate(appState.s.e.c.tc.poolShutdownJobCancelled, {
          JobID: jobId,
        }),
        { immediateExitCode: false },
      );
      callbacks.reject(jobCancelledError);
    }
    this.taskCallbacks.clear();

    for (const worker of this.workers) {
      void worker.terminate();
    }
    this.workers = [];
    this.idleWorkers = [];
    this.isInitialized = false;

    // @ts-expect-error - for cleanup
    TokenWorkerPool.instance = undefined;
  }
}

function countApproximateTokens(str: string | null | undefined): number {
  if (!str) return 0;

  const cjkRegex = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7a3]/g;
  const cjkMatches = str.match(cjkRegex) || [];
  const cjkTokens = cjkMatches.length * 1.5;

  const emojiRegex = /[\p{Emoji}\p{Extended_Pictographic}]/gu;
  const emojiMatches = str.match(emojiRegex) || [];
  const emojiTokens = emojiMatches.length * 2;

  const remainingText = str.replace(cjkRegex, "").replace(emojiRegex, "");

  const otherTokens = remainingText.length / 4;

  return Math.ceil(cjkTokens + emojiTokens + otherTokens);
}

function dummyTokenCounter(input: ParallelCountInput): number {
  const { text, text_pair, options } = input;

  let tokenCount = 0;
  tokenCount += countApproximateTokens(text);

  if (text_pair) {
    tokenCount += countApproximateTokens(text_pair);
    tokenCount += 1;
  }

  if (options?.add_special_tokens) {
    tokenCount += 3;
  }

  return tokenCount;
}

export async function countTokensInParallel(
  tokenizerName: string,
  inputs: ParallelCountInput[],
  options: { numWorkers?: number } = {},
): Promise<number[]> {
  if (tokenizerName === "dummy") {
    return Promise.resolve(inputs.map(dummyTokenCounter));
  }

  if (inputs.length === 0) return [];

  const pool = TokenWorkerPool.getInstance();
  pool.initialize();

  const { sharedTokenizerBuffer, sharedConfigBuffer } =
    await getSerializedSharedBuffers(tokenizerName);

  const numWorkers = options.numWorkers
    ? Math.min(options.numWorkers, inputs.length)
    : Math.min(cpus().length, inputs.length);

  const chunkSize = Math.ceil(inputs.length / numWorkers);
  const chunks = Array.from({ length: numWorkers }, (_, i) =>
    inputs.slice(i * chunkSize, (i + 1) * chunkSize),
  );

  const workerPromises = chunks
    .filter((chunk) => chunk.length > 0)
    .map((chunk) => {
      const payload: WorkerPayload = {
        tokenizerName,
        sharedTokenizerBuffer,
        sharedConfigBuffer,
        inputs: chunk,
      };
      return pool.runJob(payload);
    });

  const results = await Promise.all(workerPromises);
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

export function shutdownTokenCounter() {
  if (TokenWorkerPool["instance"]) {
    const pool = TokenWorkerPool.getInstance();
    pool.shutdown();
  }
}
