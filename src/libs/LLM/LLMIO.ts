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
  red,
  runConcur,
  simpleTemplate,
  StreamedLineWrapper,
  V,
  yellow,
} from "../core/index.ts";
import type {
  ConfigurablePropValue,
  LLMConfigurableProps,
  Message,
  ProgressState,
  TerminationState,
} from "../types/index.ts";
import { LLM } from "./LLM.ts";
import { validateFiles } from "./LLMIOutils.ts";
import { segmentText, stripGarbageNewLines } from "./LLMutils.ts";

type ConfigurableKey = keyof LLMConfigurableProps;
type ValidatorFn<T> = (value: unknown) => asserts value is T;
type ConfigEntry<T> = {
  prop: ConfigurableKey;
  validate: ValidatorFn<T>;
};

let _ARG_CONFIG: {
  [K in ConfigurableKey]?: ConfigEntry<LLMConfigurableProps[K]>;
};

function getArgConfig() {
  if (_ARG_CONFIG) {
    return _ARG_CONFIG;
  }

  const appState = AppStateSingleton.getInstance();
  _ARG_CONFIG = {
    chunkSize: {
      prop: "chunkSize",
      validate: V.num(
        { minExclusive: 0, max: 200000, integer: true, allowNaN: false },
        appState.s.e.v.invalidChunkSize,
        "INVALID_CHUNK_SIZE",
        "{{ .ChunkSize }}",
      ),
    },
    batchSize: {
      prop: "batchSize",
      validate: V.num(
        { minExclusive: 0, max: 64, integer: true, allowNaN: false },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
      ),
    },
    concurrency: {
      prop: "concurrency",
      validate: V.num(
        { minExclusive: 0, max: 64, integer: true, allowNaN: false },
        appState.s.e.v.invalidBatchSize,
        "INVALID_BATCH_SIZE",
        "{{ .BatchSize }}",
      ),
    },
    lastIndex: {
      prop: "lastIndex",
      validate: V.num(
        { min: 0, integer: true, allowNaN: false },
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

    const propsToAssign: Partial<LLMConfigurableProps> = {};
    const optionKeys = Object.keys(options) as Array<
      keyof LLMConfigurableProps
    >;

    const ARG_CONFIG = getArgConfig();
    for (const key of optionKeys) {
      const optionValue = options[key];
      if (key in ARG_CONFIG) {
        const configEntry = ARG_CONFIG[key];
        if (configEntry) {
          configEntry.validate(optionValue);
          (propsToAssign as Record<ConfigurableKey, ConfigurablePropValue>)[
            configEntry.prop
          ] = optionValue;
        }
      }
    }
    Object.assign(this, propsToAssign);
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
    try {
      const fStatePath = path.join(
        this.appState.STATE_DIR,
        `${this.hash}.json`,
      );

      const stateToSave: ProgressState = {
        fileName: this.fileName,
        lastIndex: this.lastIndex,
        llmbackend: this.llmbackend,
        url: this.url,
        apiKey: this.apiKey,
        delay: this.delay,
        model: this.model,
        temperature: this.temperature,
        top_p: this.top_p,
        top_k: this.top_k,
        presence_penalty: this.presence_penalty,
        seed: this.seed,
        chat_template_kwargs: this.chat_template_kwargs,
        systemPrompt: this.systemPrompt,
        prependPrompt: this.prependPrompt,
        chunkSize: this.chunkSize,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      };
      // save content first
      if (this.processedBatch.length > 0) {
        const normalized = stripGarbageNewLines(this.processedBatch);
        let needsNewline = false;

        let fileHandle;
        try {
          fileHandle = await open(this.targetPath, "a+");
          const stats = await fileHandle.stat();

          if (stats.size > 0) {
            const buf = Buffer.alloc(1);
            await fileHandle.read(buf, 0, 1, stats.size - 1);
            needsNewline = buf.toString("utf8") !== "\n";
          }

          const toWrite = (needsNewline ? "\n\n" : "") + normalized;
          await fileHandle.write(toWrite, undefined, "utf-8");
        } finally {
          if (fileHandle) {
            await fileHandle.close();
          }
        }

        this.processedBatch = [];
      }
      await writeFile(fStatePath, JSON.stringify(stateToSave, null, 2));
    } catch (err) {
      throw createError(this.appState.s.e.lllm.failedToSaveProgress, {
        cause: err,
      });
    }
  }

  async processBatch() {
    const batch = this.chunks.slice(
      this.lastIndex,
      this.lastIndex + this.batchSize,
    );
    const tasks = batch.map(
      (chunk) => () => this.completion(this.newPrompt(chunk)),
    );
    const result = await runConcur(tasks, { concurrency: this.concurrency });

    return result;
  }

  async *generateProcessedBatches() {
    let lastRunTime = 0;
    while (this.lastIndex < this.chunks.length) {
      const now = Date.now();
      const elapsed = now - lastRunTime;
      const delay = Math.max((this.delay![1] ?? 60000) - elapsed, 0);
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
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
      fs.closeSync(this.lockFileDescriptor);
      this.lockFileDescriptor = null;

      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
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
        errlog(red(this.appState.s.m.lllm.quittingWithoutSaving));
        this.close();
        process.exit(1);
      }
    };

    process.on("SIGINT", signalHandler);
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
        if (this.terminationState !== LLMBATCHERUI.TerminationState.NONE) break;
      }
    } catch (err) {
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
    } finally {
      if (!this.appState.DEBUG_MODE) {
        await lineWrapper.flush();
      }

      await this.saveProgress();
      this.close();
      process.off("SIGINT", signalHandler);
      log(yellow(this.appState.s.m.lllm.progressSavedTerminating));
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
