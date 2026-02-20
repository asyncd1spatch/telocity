import { readFile } from "node:fs/promises";
import {
  AppStateSingleton,
  createError,
  generateHelpText,
  log,
  customParseArgs as parseArgs,
  readStdin,
  simpleTemplate,
} from "../libs/core/index.ts";
import {
  calcAvgLineLength,
  calcAvgLineLengthBytes,
  stripGarbageNewLines,
  validateFiles,
} from "../libs/LLM/index.ts";
import type { Command } from "../libs/types/index.ts";

export default class AvgCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get options() {
    return { help: { type: "boolean", short: "h" } } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof AvgCommand)
        .allowPositionals,
      strict: true,
      options: (this.constructor as typeof AvgCommand).options,
    });

    const avgHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.avg,
        (this.constructor as typeof AvgCommand).options,
      );
      log(helpText);
    };

    if (values.help) {
      avgHelp();
      return 0;
    }

    let avgBytes;
    let avgGraphemes;

    if (appState.isInteractive && !process.stdin.isTTY) {
      const rawText = await readStdin();
      const text = stripGarbageNewLines(rawText);
      avgBytes = calcAvgLineLengthBytes(text);
      avgGraphemes = calcAvgLineLength(text);
    } else {
      const sourcePath = positionals[1];
      if (!sourcePath) {
        avgHelp();
        throw createError(appState.s.e.lllm.sourceRequired, {
          code: "SOURCE_REQUIRED",
        });
      }
      await validateFiles(sourcePath);

      const rawText = await readFile(sourcePath, "utf-8");
      const text = stripGarbageNewLines(rawText);
      avgBytes = calcAvgLineLengthBytes(text);
      avgGraphemes = calcAvgLineLength(text);
    }
    log(
      simpleTemplate(appState.s.m.c.avg.averageCharsPerLine, {
        AvgChars: avgGraphemes,
      }),
    );
    log(
      simpleTemplate(appState.s.m.c.avg.averageBytesPerLine, {
        AvgBytes: avgBytes,
      }),
    );

    return 0;
  }
}
