import fs from "node:fs";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AppStateSingleton,
  blue,
  createError,
  errlog,
  exitOne,
  fastHash,
  isEexistError,
  isNodeError,
  log,
  raceWithSignal,
  red,
  resolveConfig,
  runConcur,
  simpleTemplate,
  StreamedLineWrapper,
  V,
  yellow,
} from "../core/index.ts";
import type {
  ConfigMap,
  LLMConfigurableProps,
  Message,
  ProgressState,
  TerminationState,
} from "../types/index.ts";
import { LLM } from "./LLM.ts";
import { validateFiles } from "./LLMIOutils.ts";
import { segmentText, stripGarbageNewLines } from "./LLMutils.ts";

let _ARG_CONFIG: ConfigMap<
  LLMBATCHER & LLMConfigurableProps,
  LLMConfigurableProps
>;

function getArgConfig() {
  if (_ARG_CONFIG) {
    return _ARG_CONFIG;
  }

  const appState = AppStateSingleton.getInstance();
  _ARG_CONFIG = {
    lastIndex: {
      prop: "lastIndex" as keyof (LLMBATCHER & LLMConfigurableProps),
      validate: V.num(
        { min: 0, integer: true },
        appState.s.e.v.invalidIndex,
        "INVALID_INDEX",
        "{{ .Index }}",
      ),
    },
  } as const;
  return _ARG_CONFIG;
}

export class LLMBATCHER extends LLM {
  private readonly text: string;
  private chunks: readonly string[] = [];
  protected length: number = 0;
  private processedBatch: string[];
  private readonly targetPath: string;
  private readonly fileName: string;
  private readonly hash: string = "";
  private lastIndex: number = 0;
  protected terminationState: TerminationState = LLM.TerminationState.NONE;
  private lockFilePath: string = "";
  private lockFileDescriptor: number | null = null;
  protected controller: AbortController;

  protected constructor(
    options: LLMConfigurableProps,
    sourcePath: string,
    targetPath: string,
    text: string,
    hash: string,
    llmcall?: (messages: Message[]) => Promise<string>,
  ) {
    super(options, llmcall);
    this.processedBatch = [];
    this.targetPath = targetPath;
    this.fileName = path.basename(sourcePath);
    this.text = stripGarbageNewLines(text);
    this.hash = hash;
    this.lockFilePath = path.join(this.appState.STATE_DIR, `${this.hash}.lock`);
    this.controller = new AbortController();

    const batcherState = resolveConfig<
      LLMBATCHER & LLMConfigurableProps,
      LLMConfigurableProps
    >(
      this as unknown as LLMBATCHER & LLMConfigurableProps,
      options,
      getArgConfig(),
    );
    Object.assign(this, batcherState);
  }

  private async initialize(): Promise<void> {
    try {
      if (this.text === "") {
        throw createError(this.appState.s.e.lllm.emptyFile, {
          code: "EMPTY_FILE",
        });
      }

      await this.acquireLock();

      this.chunks = segmentText(this.text, this.chunkSize);
      this.length = this.chunks.length;

      if (this.lastIndex === this.length && this.length > 0) {
        this.close();
        throw createError(this.appState.s.m.lllm.processingComplete, {
          code: "PROCESSING_ALREADY_COMPLETE",
        });
      }
    } catch (err) {
      this.close();
      throw createError(this.appState.s.e.lllm.initializingBatch, {
        cause: err,
      });
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async acquireLock(): Promise<void> {
    try {
      this.lockFileDescriptor = fs.openSync(this.lockFilePath, "wx");
    } catch (err) {
      if (isEexistError(err)) {
        throw createError(this.appState.s.m.lllm.anotherInstanceIsProcessing, {
          cause: err,
        });
      }
      throw createError(this.appState.s.e.lllm.failedLock, { cause: err });
    }
  }

  private static async loadProgressState(
    hash: string,
  ): Promise<ProgressState | null> {
    const stateFilePath = path.join(
      AppStateSingleton.getInstance().STATE_DIR,
      `${hash}.json`,
    );
    try {
      await fs.promises.access(stateFilePath);
      const content = await readFile(stateFilePath, "utf-8");
      const parsedState = JSON.parse(content) as ProgressState;
      return parsedState && typeof parsedState === "object"
        ? parsedState
        : null;
    } catch {
      return null;
    }
  }

  async saveProgress() {
    if (!this.lockFileDescriptor) return;

    try {
      const fStatePath = path.join(
        this.appState.STATE_DIR,
        `${this.hash}.json`,
      );

      const stateToSave: ProgressState = {
        fileName: this.fileName,
        lastIndex: this.lastIndex,
        url: this.url,
        apiKey: this.apiKey,
        delay: this.delay,
        maxAttempts: this.maxAttempts,
        tempIncrement: this.tempIncrement,
        model: this.model,
        temperature: this.temperature,
        top_p: this.top_p,
        top_k: this.top_k,
        presence_penalty: this.presence_penalty,
        seed: this.seed,
        timeout: this.timeout,
        systemPrompt: this.systemPrompt,
        prependPrompt: this.prependPrompt,
        prefill: this.prefill,
        chunkSize: this.chunkSize,
        batchSize: this.batchSize,
        parallel: this.parallel,
        chat_template_kwargs: this.chat_template_kwargs, // llama.cpp
        reasoning_effort: this.reasoning_effort, // v1/chat/completions official
        reasoning: this.reasoning, // v1/responses official
        enable_thinking: this.enable_thinking, // Alibaba Cloud Model Studio
      };

      // save content first
      if (this.processedBatch.length > 0) {
        const normalized = stripGarbageNewLines(this.processedBatch);
        let prefix = "";

        let fileHandle;
        try {
          fileHandle = await open(this.targetPath, "a+");
          const stats = await fileHandle.stat();

          if (stats.size > 0) {
            const readLen = Math.min(stats.size, 2);
            const buf = Buffer.alloc(readLen);
            await fileHandle.read(buf, 0, readLen, stats.size - readLen);
            const tail = buf.toString("utf8");
            if (tail.endsWith("\n\n")) {
              prefix = "";
            } else if (tail.endsWith("\n")) {
              prefix = "\n";
            } else {
              prefix = "\n\n";
            }
          }

          const toWrite = prefix + normalized;
          await fileHandle.write(toWrite, undefined, "utf-8");
        } finally {
          if (fileHandle) {
            await fileHandle.close();
          }
        }

        this.processedBatch = [];
      }

      await writeFile(fStatePath, this.appState.stringifyReadable(stateToSave));
    } catch (err) {
      throw createError(this.appState.s.e.lllm.failedToSaveProgress, {
        cause: err,
      });
    }
  }

  async processBatch() {
    const tasks = this.chunks
      .slice(this.lastIndex, this.lastIndex + this.batchSize)
      .map((chunk) => {
        const run = async (
          attempt = 1,
          temp = this.temperature?.[0] ? this.temperature[1] : 0.7,
        ) => {
          if (this.controller.signal.aborted) {
            throw createError(this.appState.s.e.lcli.processingAborted, {
              code: "ABORT_ERR",
              immediateExitCode: false,
            });
          }

          try {
            return await raceWithSignal(
              this.completion(this.newPrompt(chunk), {
                overrides: { temperature: [true, temp] },
                signal: this.controller.signal,
              }),
              this.controller.signal,
            );
          } catch (err) {
            if (this.controller.signal.aborted) {
              throw err;
            }

            if (attempt >= this.maxAttempts) {
              this.controller.abort();
              throw err;
            }

            let nextTemp = temp;
            if (attempt >= 3) {
              nextTemp = Math.min(1.0, +(temp + this.tempIncrement).toFixed(2));
            }

            const baseDelay = Math.pow(2, attempt) * 5000;
            const jitter = Math.random() * 1000;
            const waitTime = Math.min(
              60000,
              Math.max(this.delay, baseDelay + jitter),
            );

            log(
              yellow(
                simpleTemplate(this.appState.s.m.lllm.retryWithTemp, {
                  Attempt: "" + attempt,
                  Temp: nextTemp,
                }),
              ),
            );

            await this.interruptibleDelay(waitTime);
            return run(attempt + 1, nextTemp);
          }
        };
        return run;
      });
    return runConcur(tasks, { concurrency: this.parallel });
  }

  private async interruptibleDelay(ms: number): Promise<void> {
    if (ms <= 0) return;

    if (this.controller.signal.aborted) {
      throw createError(this.appState.s.e.lcli.processingAborted, {
        code: "ABORT_ERR",
        immediateExitCode: false,
      });
    }

    return new Promise((resolve, reject) => {
      // (onAbort needs timer, timer needs onAbort)
      // eslint-disable-next-line prefer-const
      let timer: ReturnType<typeof setTimeout>;

      const onAbort = () => {
        if (timer) clearTimeout(timer);
        this.controller.signal.removeEventListener("abort", onAbort);
        reject(
          createError(this.appState.s.e.lcli.processingAborted, {
            code: "ABORT_ERR",
            immediateExitCode: false,
          }),
        );
      };

      timer = setTimeout(() => {
        this.controller.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);

      this.controller.signal.addEventListener("abort", onAbort);
    });
  }

  async *generateProcessedBatches() {
    let lastRunTime = 0;
    while (this.lastIndex < this.chunks.length) {
      if (this.controller.signal.aborted) break;

      const now = Date.now();
      const elapsed = now - lastRunTime;

      const delay = Math.max(this.delay - elapsed, 0);

      if (delay > 0) {
        await this.interruptibleDelay(delay);
      }
      lastRunTime = Date.now();

      const processedBatch = await this.processBatch();
      this.processedBatch.push(...processedBatch);

      this.lastIndex = Math.min(
        this.lastIndex + this.batchSize,
        this.chunks.length,
      );

      yield { processedBatch, lastIndex: this.lastIndex };
    }
  }

  close() {
    if (this.lockFileDescriptor) {
      try {
        fs.closeSync(this.lockFileDescriptor);
      } catch {
        /* nyo */
      }
      this.lockFileDescriptor = null;

      if (fs.existsSync(this.lockFilePath)) {
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          /* nyo */
        }
      }
    }
  }

  public static async init(
    options: LLMConfigurableProps,
    sourcePath: string,
    targetPath: string,
    llmcall?: (messages: Message[]) => Promise<string>,
  ): Promise<LLMBATCHER> {
    await validateFiles(sourcePath, targetPath);
    const text = await readFile(sourcePath, "utf-8");
    const hash = fastHash(text);

    const loadedState = await this.loadProgressState(hash);

    let finalOptions: LLMConfigurableProps;
    if (loadedState) {
      finalOptions = loadedState;
    } else {
      finalOptions = { ...options, lastIndex: 0 };
    }

    const instance = new this(
      finalOptions,
      sourcePath,
      targetPath,
      text,
      hash,
      llmcall,
    );
    await instance.initialize();
    return instance;
  }

  async execute(): Promise<void> {}

  public cancel(): void {
    if (!this.controller.signal.aborted) {
      this.controller.abort();
    }
  }
}

export class LLMBATCHERUI extends LLMBATCHER {
  constructor(
    options: LLMConfigurableProps,
    sourcePath: string,
    targetPath: string,
    text: string,
    hash: string,
    llmcall?: (messages: Message[]) => Promise<string>,
  ) {
    super(options, sourcePath, targetPath, text, hash, llmcall);
  }

  override async execute(): Promise<void> {
    const delay = 500;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const lineWrapper = new StreamedLineWrapper(
      this.appState.TERMINAL_WIDTH,
      // eslint-disable-next-line @typescript-eslint/require-await
      async (chunk) => {
        process.stdout.write(chunk);
      },
    );

    const signalHandler = () => {
      if (this.terminationState === LLMBATCHERUI.TerminationState.NONE) {
        this.terminationState = LLMBATCHERUI.TerminationState.REQUESTED;
        log(red(this.appState.s.m.lllm.ctrlCPressed));
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            this.terminationState = LLMBATCHERUI.TerminationState.FORCEFUL;
          }, delay);
        }
      } else if (
        this.terminationState === LLMBATCHERUI.TerminationState.REQUESTED
      ) {
        log(this.appState.s.m.lllm.ctrlCPressed2);
      } else {
        // Forceful termination (3rd strike)
        errlog(red(this.appState.s.m.lllm.quittingWithoutSaving));
        this.controller.abort();
      }
    };

    if (this.appState.isInteractive) {
      process.on("SIGINT", signalHandler);
    }

    try {
      if (this.appState.DEBUG_MODE) {
        log(this.toString());
      }

      for await (const {
        processedBatch,
        lastIndex,
      } of this.generateProcessedBatches()) {
        for (const [i, processedChunk] of processedBatch.entries()) {
          if (this.appState.DEBUG_MODE) {
            log(processedChunk);
          } else {
            await lineWrapper.write(processedChunk);
            await lineWrapper.flush();
          }

          log(
            blue(
              simpleTemplate(this.appState.s.m.lllm.processedChunkOf, {
                Processed: lastIndex - processedBatch.length + i + 1,
                Total: this.length,
              }),
            ),
          );
        }

        if (this.terminationState !== LLMBATCHERUI.TerminationState.NONE) {
          break;
        }
      }
    } catch (err) {
      if (
        isNodeError(err) &&
        (err.code === "ABORT_ERR" || err.name === "AbortError")
      ) {
        exitOne();
      } else {
        exitOne();
        if (isNodeError(err)) {
          errlog(red(this.appState.s.e.lllm.llmAPICall + err.message));
          if (isNodeError(err.cause)) {
            errlog(
              red(`>Cause: ${err.cause.message || JSON.stringify(err.cause)}`),
            );
          }
        } else {
          errlog(red(this.appState.s.e.lllm.llmAPICall + String(err)));
        }
      }
    } finally {
      if (!this.appState.DEBUG_MODE) {
        await lineWrapper.flush();
      }

      if (!this.controller.signal.aborted) {
        await this.saveProgress();
        log(yellow(this.appState.s.m.lllm.progressSavedTerminating));
      } else {
        log(red(this.appState.s.m.lllm.terminatedForcefully));
      }

      this.close();

      if (this.appState.isInteractive) {
        process.off("SIGINT", signalHandler);
      }

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
