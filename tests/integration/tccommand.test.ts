import { describe, expect, test } from "vitest";
import { main } from "../../src/main.ts";
import { withCapturedConsole } from "../testutils.ts";

describe("TcCommand", () => {
  test("TcCommand should count tokens for mistral", async () => {
    const originalIsTTY = process.stdin.isTTY;
    try {
      Object.defineProperty(process.stdin, "isTTY", {
        value: true,
        writable: true,
      });
      const output = await withCapturedConsole(async () => {
        await main(
          ["tc", "--params", "mistral", "./tests/data/tokens.txt"],
          false,
        );
      });
      expect(output).toContain("3986");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", {
        value: originalIsTTY,
        writable: true,
      });
    }
  });
});
