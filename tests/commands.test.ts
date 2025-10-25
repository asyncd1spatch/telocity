import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import { validateFiles } from "../src/libs/LLM";
import { main } from "../src/main";
import { initTest, setupTestEnvironment, teardownTestEnvironment, withCapturedConsole } from "./testutils";

type TestEnvironment = Awaited<ReturnType<typeof setupTestEnvironment>>;

describe("Commands", () => {
  let testEnv: TestEnvironment;

  beforeAll(async () => {
    await initTest();
    testEnv = await setupTestEnvironment();
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  describe("Sanity checks", () => {
    test.serial("HelpCommand shows generic help", async () => {
      process.env["LC_ALL"] = "en_US.UTF-8";
      process.env["LANG"] = "en_US.UTF-8";
      const output = await withCapturedConsole(async () => {
        await main(["help"], false);
      });
      expect(output).toMatch(/A tool for batch processing text with LLMs/);
    });
  });

  describe("SplitCommand", () => {
    test("should split a file into multiple parts", async () => {
      const splitOutDir = path.join(testEnv.outDir, "split");

      await withCapturedConsole(async () => {
        await main([
          "sp",
          "-s",
          "0.01",
          "./tests/data/source.txt",
          splitOutDir,
        ], false);
      });

      const [expected1, actual1, expected2, actual2] = await Promise.all([
        Bun.file("./tests/data/split/source_part1.txt").text(),
        Bun.file(path.join(splitOutDir, "source_part1.txt")).text(),
        Bun.file("./tests/data/split/source_part2.txt").text(),
        Bun.file(path.join(splitOutDir, "source_part2.txt")).text(),
      ]);
      expect(actual1).toBe(expected1);
      expect(actual2).toBe(expected2);
    });
  });

  describe("StripCommand", () => {
    test("should strip empty lines from a file", async () => {
      const strippedFile = path.join(testEnv.outDir, "stripped.txt");
      await withCapturedConsole(async () => {
        await main([
          "st",
          "--compress",
          "./tests/data/toStrip.txt",
          strippedFile,
        ], false);
      });
      const content = await Bun.file(strippedFile).text();
      expect(content).toBe("Line one\nLine two\nLine three");
    });
  });

  describe("Error handling", () => {
    test("throws error if source file does not exist", () => {
      expect(
        async () => await validateFiles("./tests/data/nonexistent.txt", testEnv.targetFile),
      ).toThrow(Error);
    });
  });

  describe("MergeCommand", () => {
    test("should merge files correctly after setting locale", async () => {
      process.env["LC_ALL"] = "en_US.UTF-8";
      process.env["LANG"] = "en_US.UTF-8";
      const mergedDir = path.join(testEnv.outDir, "merged");
      await fs.mkdir(mergedDir, { recursive: true });

      await withCapturedConsole(async () => {
        await main([
          "mg",
          "-e",
          "txt",
          "./tests/data/split",
          mergedDir,
        ], false);
      });

      const [expected, actual] = await Promise.all([
        Bun.file("./tests/data/merged.txt").text(),
        Bun.file(path.join(mergedDir, "txt_merged.txt")).text(),
      ]);
      expect(actual).toBe(expected);
    });
  });
});
