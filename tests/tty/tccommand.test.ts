import { describe, expect, test } from "bun:test";
import { main } from "../../src/main";
import { withCapturedConsole } from "../testutils";

describe("AvgCommand", async () => {
  test("TcCommand should count tokens for granite", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        writable: true,
      });
      const output = await withCapturedConsole(async () => {
        await main([
          "tc",
          "--params",
          "gemma",
          "./tests/data/tokens.txt",
        ], false);
      });
      expect(output).toContain("4016");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        writable: true,
      });
    }
  });
});
