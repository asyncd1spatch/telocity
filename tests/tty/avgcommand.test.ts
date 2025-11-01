import { describe, expect, test } from "bun:test";
import { main } from "../../src/main";
import { withCapturedConsole } from "../testutils";

describe("AvgCommand", async () => {
  test("AvgCommand should calculate line averages", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        writable: true,
      });

      const output = await withCapturedConsole(async () => {
        await main(["avg", "./tests/data/tokens.txt"], false);
      });
      expect(output).toContain(": 49");
      expect(output).toContain(": 143");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        writable: true,
      });
    }
  });
});
