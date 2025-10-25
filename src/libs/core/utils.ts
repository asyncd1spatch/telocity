import { RunConcurOpts } from "../types";

export function runConcur<T extends readonly (() => Promise<any>)[]>(
  tasks: T,
  options?: { concurrency?: number },
): Promise<
  {
    [K in keyof T]: T[K] extends () => Promise<infer R> ? R : never;
  }
>;

export function runConcur<T extends readonly (() => Promise<any>)[]>(
  tasks: T,
  options: { concurrency?: number; allSettled: true },
): Promise<
  {
    [K in keyof T]: PromiseSettledResult<T[K] extends () => Promise<infer R> ? R : never>;
  }
>;

export function runConcur<T extends readonly (() => Promise<any>)[]>(
  tasks: T,
  options?: RunConcurOpts,
): Promise<any> {
  const concurrency = Math.max(1, Math.floor(options?.concurrency ?? 1));
  const allSettled = options?.allSettled ?? false;

  const len = tasks.length;
  if (len === 0) return Promise.resolve([]) as any;

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
          results[i] = allSettled ? { status: "fulfilled", value } : value;
        } catch (reason) {
          if (allSettled) {
            results[i] = { status: "rejected", reason };
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
              resolve(results as any);
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
