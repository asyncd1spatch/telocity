import fs from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import {
  AppStateSingleton,
  blue,
  createError,
  errlog,
  exitOne,
  isEexistError,
  isNodeError,
  LineWrapper,
  log,
  red,
  runConcur,
  simpleTemplate,
  V,
  yellow,
} from "../core";
import type { ConfigurablePropValue, LLMConfigurableProps, Message, ProgressState, TerminationState } from "../types";
import { LLM } from "./LLM";
import { validateFiles } from "./LLMIOutils";
import { segmentText, stripGarbageNewLines } from "./LLMutils";

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

export class LLMIO extends LLM {
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
    const optionKeys = Object.keys(options) as Array<keyof LLMConfigurableProps>;

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

  private async _initialize(): Promise<void> {
    try {
      if (this.text === "") {
        throw createError(this.appState.s.e.lllm.emptyFile, { code: "EMPTY_FILE" });
      }

      await this._acquireLock();

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
      throw createError(this.appState.s.e.lllm.initializingBatch, { cause: err });
    }
  }

  private async _acquireLock(): Promise<void> {
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

  private static async _loadProgressState(hash: string): Promise<ProgressState | null> {
    const stateFilePath = path.join(
      AppStateSingleton.getInstance().STATE_DIR,
      `${hash}.json`,
    );
    const stateFile = Bun.file(stateFilePath);
    if (!(await stateFile.exists())) {
      return null;
    }
    try {
      const parsedState = (await stateFile.json()) as ProgressState;
      return parsedState && typeof parsedState === "object" ? parsedState : null;
    } catch {
      return null;
    }
  }

  async saveProgress() {
    try {
      const fStatePath = path.join(this.appState.STATE_DIR, `${this.hash}.json`);

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
        min_p: this.min_p,
        top_k: this.top_k,
        repeat_penalty: this.repeat_penalty,
        frequency_penalty: this.frequency_penalty,
        presence_penalty: this.presence_penalty,
        seed: this.seed,
        systemPrompt: this.systemPrompt,
        prependPrompt: this.prependPrompt,
        chunkSize: this.chunkSize,
        batchSize: this.batchSize,
        concurrency: this.concurrency,
      };

      await Bun.write(fStatePath, JSON.stringify(stateToSave, null, 2));

      if (this.processedBatch.length > 0) {
        const normalized = stripGarbageNewLines(this.processedBatch);
        let needsNewline = false;

        const targetFile = Bun.file(this.targetPath);
        if ((await targetFile.exists()) && targetFile.size > 0) {
          const lastChar = await targetFile.slice(-1).text();
          needsNewline = lastChar !== "\n";
        }

        const toWrite = (needsNewline ? "\n\n" : "") + normalized;
        await appendFile(this.targetPath, toWrite, "utf-8");
        this.processedBatch = [];
      }
    } catch (err) {
      throw createError(this.appState.s.e.lllm.failedToSaveProgress, { cause: err });
    }
  }

  async processBatch() {
    const batch = this.chunks.slice(
      this.lastIndex,
      this.lastIndex + this.batchSize,
    );
    const tasks = batch.map(chunk => () => this.completion(this.formatMessages(chunk)));
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
        Bun.sleepSync(delay);
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
  ): Promise<LLMIO> {
    await validateFiles(sourcePath, targetPath);
    const text = await Bun.file(sourcePath).text();
    const hash = Bun.hash(text).toString();

    const loadedState = await this._loadProgressState(hash);

    let finalOptions: LLMConfigurableProps;

    if (loadedState) {
      finalOptions = loadedState;
    } else {
      finalOptions = { ...options, lastIndex: 0 };
    }

    const instance = new this(finalOptions, sourcePath, targetPath, text, hash, llmcall);
    await instance._initialize();
    return instance;
  }

  async execute(): Promise<void> {}
}

export class UILLMIO extends LLMIO {
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
    let timeoutId: Timer | null = null;
    const lineWrapper = new LineWrapper(this.appState.TERMINAL_WIDTH);

    const signalHandler = () => {
      if (this.terminationState === UILLMIO.TerminationState.NONE) {
        this.terminationState = UILLMIO.TerminationState.REQUESTED;
        log(red(this.appState.s.m.lllm.ctrlCPressed));
        if (!timeoutId) {
          timeoutId = setTimeout(() => {
            this.terminationState = UILLMIO.TerminationState.FORCEFUL;
          }, delay);
        }
      } else if (this.terminationState === UILLMIO.TerminationState.REQUESTED) {
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
      for await (
        const {
          processedBatch,
          lastIndex,
        } of this.generateProcessedBatches()
      ) {
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
        if (this.terminationState !== UILLMIO.TerminationState.NONE) break;
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
