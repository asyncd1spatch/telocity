import type { BunFile } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppStateSingleton } from "../src/libs/core";
import { deleteProgressEntry, splitFile, validateFiles } from "../src/libs/LLM";
import type { AppState } from "../src/libs/types";
import { initTest } from "./testutils";

describe("LLM IO utils (file helpers)", () => {
  let appState: AppState;
  let tmpDir!: string;
  let srcFile!: string;
  let targetDir!: string;
  let originalStateDir!: string;

  beforeAll(async () => {
    await initTest();
    appState = AppStateSingleton.getInstance();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "llmio-test-"));
    srcFile = path.join(tmpDir, "source.txt");
    targetDir = path.join(tmpDir, "out");
    originalStateDir = appState.STATE_DIR;
    Object.defineProperty(appState, "STATE_DIR", {
      value: path.join(tmpDir, "state"),
      writable: true,
      configurable: true,
    });
    await fs.mkdir(appState.STATE_DIR, { recursive: true });
  });

  afterAll(async () => {
    Object.defineProperty(appState, "STATE_DIR", {
      value: originalStateDir,
      writable: true,
      configurable: true,
    });
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("validateFiles throws when source and target are identical", async () => {
    try {
      const filePath = path.join(tmpDir, "same.txt");
      await Bun.write(filePath, "x");
      await validateFiles(filePath, filePath);
      expect.unreachable("Expected validateFiles to throw");
    } catch (err: any) {
      expect(err.name).not.toBe("UnreachableError");
    }
  });

  test("splitFile returns single-path array when file <= max bytes (no splitting)", async () => {
    const small = "short content\n";
    await Bun.write(srcFile, small);
    const out: string[] = await splitFile(srcFile, targetDir, 10);
    expect(out).toBeInstanceOf(Array);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(srcFile);
    expect(await Bun.file(targetDir).exists()).toBe(false);
  });

  test("splitFile splits when file > maxBytes and produces part files", async () => {
    const maxPartSizeBytes = 1 * 1024 * 1024;
    const line = "This is a line of text that will be repeated to create a large file.\n";
    const lineSize = Buffer.byteLength(line, "utf8");

    const linesNeeded = Math.ceil((1.2 * maxPartSizeBytes) / lineSize);
    const largeContent = line.repeat(linesNeeded);

    await Bun.write(srcFile, largeContent);

    const parts: string[] = await splitFile(srcFile, targetDir, 1);

    expect(parts).toBeInstanceOf(Array);
    expect(parts.length).toBe(2);

    for (const p of parts) {
      const partFile: BunFile = Bun.file(p);
      expect(await partFile.exists()).toBe(true);
      expect(partFile.size).toBeGreaterThan(0);
    }
  });

  test("deleteProgressEntry deletes state file and returns confirmation message", async () => {
    const content = JSON.stringify({ fileName: "foo.txt" });
    const hash = Bun.hash("mycontent").toString();
    const fname = path.join(appState.STATE_DIR, `${hash}.json`);
    await Bun.write(fname, content);
    expect(await Bun.file(fname).exists()).toBe(true);

    const msg: string = await deleteProgressEntry(hash);
    expect(msg).toBeTypeOf("string");
    expect(msg).toInclude(hash);
    expect(await Bun.file(fname).exists()).toBe(false);
  });

  test("deleteProgressEntry throws when called with empty hash", () => {
    expect(async () => await deleteProgressEntry("")).toThrow(
      /EMPTY_HASH_PROVIDED|empty/i,
    );
  });
});
