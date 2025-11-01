import { RunConcurOpts } from "../types";

type TaskFn<R = unknown> = () => Promise<R>;
type ResultOf<T> = T extends () => Promise<infer R> ? R : never;

export function runConcur<T extends readonly TaskFn[]>(
  tasks: T,
  options?: { concurrency?: number },
): Promise<{ [K in keyof T]: ResultOf<T[K]> }>;

export function runConcur<T extends readonly TaskFn[]>(
  tasks: T,
  options: { concurrency?: number; allSettled: true },
): Promise<{ [K in keyof T]: PromiseSettledResult<ResultOf<T[K]>> }>;

export function runConcur<T extends readonly TaskFn[]>(
  tasks: T,
  options?: RunConcurOpts,
): Promise<unknown> {
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
  const allSettled = options?.allSettled ?? false;

  const len = tasks.length;
  if (len === 0) {
    return Promise.resolve([]) as Promise<{ [K in keyof T]: ResultOf<T[K]> }>;
  }

  return new Promise((resolve, reject) => {
    const results: unknown[] = Array.from({ length: len });
    const workerCount = Math.min(concurrency, len);

    let nextIndex = 0;
    let settledCount = 0;
    let hasRejected = false;

    async function worker(): Promise<void> {
      while (true) {
        if (hasRejected) return;

        const i = nextIndex++;
        if (i >= len) return;

        try {
          const value = await tasks[i]!();
          if (hasRejected) return;
          results[i] = allSettled
            ? ({ status: "fulfilled", value } as PromiseFulfilledResult<unknown>)
            : value;
        } catch (reason) {
          if (allSettled) {
            results[i] = { status: "rejected", reason } as PromiseRejectedResult;
          } else {
            if (!hasRejected) {
              hasRejected = true;
              reject(reason);
            }
            return;
          }
        } finally {
          settledCount++;
          if (settledCount === len) {
            if (!hasRejected) {
              resolve(results as { [K in keyof T]: unknown });
            }
          }
        }
      }
    }

    for (let i = 0; i < workerCount; i++) {
      worker();
    }
  });
}

export class LineWrapper {
  private buffer = "";
  private currentLineWidth = 0;
  private readonly terminalWidth: number;
  private readonly maxBufferLength: number;
  private readonly onChunk?: (s: string) => Promise<void> | void;
  private readonly writeFn: (stream: unknown, data: string) => Promise<void> | void;

  constructor(terminalWidth: number, maxBufferLength = 4096, opts?: {
    onChunk?: (s: string) => Promise<void> | void;
    writeFn?: (stream: unknown, data: string) => Promise<void> | void;
  }) {
    this.terminalWidth = terminalWidth ?? 80;
    this.maxBufferLength = maxBufferLength;
    this.onChunk = opts?.onChunk;
    this.writeFn = opts?.writeFn ?? (async (_stream: unknown, data: string) => {
      await Bun.write(Bun.stdout, data);
    });
  }

  private async emit(data: string) {
    if (!data) return;
    if (this.onChunk) {
      await this.onChunk(data);
    } else {
      await this.writeFn(Bun.stdout, data);
    }
  }

  private async printWord(word: string) {
    if (!word) return;

    const wordWidth = Bun.stringWidth(word);
    const spaceWidth = this.currentLineWidth > 0 ? 1 : 0;

    if (this.currentLineWidth > 0 && this.currentLineWidth + spaceWidth + wordWidth > this.terminalWidth) {
      await this.emit("\n");
      this.currentLineWidth = 0;
    }

    if (this.currentLineWidth > 0) {
      await this.emit(" ");
      this.currentLineWidth += 1;
    }

    await this.emit(word);
    this.currentLineWidth += wordWidth;
  }

  public async write(chunk: string) {
    this.buffer += chunk;

    const lastSpaceIndex = this.buffer.lastIndexOf(" ");
    const lastNewlineIndex = this.buffer.lastIndexOf("\n");
    const boundaryIndex = Math.max(lastSpaceIndex, lastNewlineIndex);

    if (boundaryIndex === -1) {
      if (this.buffer.length > this.maxBufferLength) {
        await this.flush(true);
      }
      return;
    }

    const toProcess = this.buffer.substring(0, boundaryIndex);
    this.buffer = this.buffer.substring(boundaryIndex + 1);

    const lines = toProcess.split("\n");
    for (const [i, line] of lines.entries()) {
      const words = line.split(" ").filter(Boolean);
      for (const word of words) {
        await this.printWord(word);
      }

      if (i < lines.length - 1) {
        await this.emit("\n");
        this.currentLineWidth = 0;
      }
    }
  }

  public async flush(force = false) {
    if (this.buffer) {
      const words = this.buffer.split(" ").filter(Boolean);
      for (const word of words) {
        await this.printWord(word);
      }
      this.buffer = "";
    }

    if (this.currentLineWidth > 0 && !force) {
      await this.emit("\n");
      this.currentLineWidth = 0;
    }
  }
}
