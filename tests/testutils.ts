import { spyOn } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as appCore from "../src/libs/core";
import { deleteProgressEntry, stripGarbageNewLines } from "../src/libs/LLM";

let initialized: boolean;
export let appState: Awaited<ReturnType<typeof appCore.configInit>>;
export let SOURCE_FILE = "./tests/data/source.txt";
export let SOURCE_FILE2 = "./tests/data/source2.txt";
export let sourceFileContent: string;
export let sourceFileContent2: string;
export let sourceFileHash: string;
export let sourceFileHash2: string;

export async function initTest() {
  if (initialized) return;
  appState = await appCore.configInit(true);
  sourceFileContent = await Bun.file(SOURCE_FILE).text();
  sourceFileContent2 = await Bun.file(SOURCE_FILE2).text();
  sourceFileHash = Bun.hash(stripGarbageNewLines(sourceFileContent)).toString();
  sourceFileHash2 = Bun.hash(stripGarbageNewLines(sourceFileContent2)).toString();
  initialized = true;
}

export async function withCapturedConsole(fn: () => Promise<void>) {
  const capturedChunks: string[] = [];
  const spies = [];
  const captureImplementation = (...args: unknown[]) => {
    const line = args
      .map((arg) => {
        if (Buffer.isBuffer(arg)) return arg.toString();
        if (typeof arg === "object" && arg !== null) return JSON.stringify(arg);
        return String(arg);
      })
      .join(" ");

    capturedChunks.push(line);
    return true;
  };
  spies.push(spyOn(appCore, "log").mockImplementation(captureImplementation));
  spies.push(spyOn(appCore, "errlog").mockImplementation(captureImplementation));
  await fn();

  return capturedChunks.join("\n");
}

export async function cleanupProgressEntryForSource() {
  try {
    await deleteProgressEntry(sourceFileHash);
    await deleteProgressEntry(sourceFileHash2);
  } catch (err) {
    if (
      typeof err === "object"
      && err !== null
      && "code" in err
      && typeof (err as { code: unknown }).code === "string"
      && (err as { code: string }).code === "ENOENT"
    ) {
      return;
    }
    throw err;
  }
}

export type TestEnvironment = {
  tmpDir: string;
  outDir: string;
  targetFile: string;
  originalStateDir: string;
};

export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "integration-test-"));
  const outDir = path.join(tmpDir, "output");
  await fs.mkdir(outDir, { recursive: true });
  const targetFile = path.join(outDir, "processed.txt");

  const originalStateDir = appState.STATE_DIR;
  Object.defineProperty(appState, "STATE_DIR", {
    value: path.join(tmpDir, "state"),
    writable: true,
    configurable: true,
  });
  await fs.mkdir(appState.STATE_DIR, { recursive: true });

  return { tmpDir, outDir, targetFile, originalStateDir };
}

export async function teardownTestEnvironment({
  tmpDir,
  originalStateDir,
}: Partial<TestEnvironment>): Promise<void> {
  if (originalStateDir) {
    const appState = appCore.AppStateSingleton.getInstance();
    Object.defineProperty(appState, "STATE_DIR", {
      value: originalStateDir,
      writable: true,
      configurable: true,
    });
  }
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}
