import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { AppStateSingleton } from "../src/libs/core/index.ts";
import {
  deleteProgressEntry,
  splitFile,
  validateFiles,
} from "../src/libs/LLM/index.ts";
import type { AppState } from "../src/libs/types/index.ts";
import { initTest } from "./testutils.ts";

const fileExists = async (p: string) => !!(await fs.stat(p).catch(() => false));

describe("LLM IO utils (file helpers)", () => {
  let appState: AppState;
  let tmpDir: string;
  let srcFile: string;
  let targetDir: string;
  let originalStateDir: string;

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
    const filePath = path.join(tmpDir, "same.txt");
    await fs.writeFile(filePath, "x");

    await expect(validateFiles(filePath, filePath)).rejects.toThrow();
  });

  test("splitFile returns single-path array when file <= max bytes (no splitting)", async () => {
    const small = "short content\n";
    await fs.writeFile(srcFile, small);
    const out: string[] = await splitFile(srcFile, targetDir, 10);
    expect(out).toBeInstanceOf(Array);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(srcFile);
    expect(await fileExists(targetDir)).toBe(false);
  });

  test("splitFile splits when file > maxBytes and produces part files", async () => {
    const maxPartSizeBytes = 1 * 1024 * 1024;
    const line =
      "This is a line of text that will be repeated to create a large file.\n";
    const lineSize = Buffer.byteLength(line, "utf8");

    const linesNeeded = Math.ceil((1.2 * maxPartSizeBytes) / lineSize);
    const largeContent = line.repeat(linesNeeded);

    await fs.writeFile(srcFile, largeContent);

    const parts: string[] = await splitFile(srcFile, targetDir, 1);

    expect(parts).toBeInstanceOf(Array);
    expect(parts.length).toBe(2);

    for (const p of parts) {
      expect(await fileExists(p)).toBe(true);
      const stat = await fs.stat(p);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  test("deleteProgressEntry deletes state file and returns confirmation message", async () => {
    const content = JSON.stringify({ fileName: "foo.txt" });
    const hash = crypto.createHash("sha1").update("mycontent").digest("hex");
    const fname = path.join(appState.STATE_DIR, `${hash}.json`);
    await fs.writeFile(fname, content);
    expect(await fileExists(fname)).toBe(true);

    const msg: string = await deleteProgressEntry(hash);
    expect(typeof msg).toBe("string");
    expect(msg).toContain(hash);
    expect(await fileExists(fname)).toBe(false);
  });

  test("deleteProgressEntry throws when called with empty hash", async () => {
    await expect(deleteProgressEntry("")).rejects.toThrow(
      /EMPTY_HASH_PROVIDED|empty/i,
    );
  });
});
