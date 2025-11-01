import {
  AppStateSingleton,
  createError,
  customParseArgs as parseArgs,
  generateHelpText,
  log,
  simpleTemplate,
} from "../libs/core";
import { calcAvgLineLength, calcAvgLineLengthBytes, stripGarbageNewLines, validateFiles } from "../libs/LLM";
import type { Command } from "../libs/types";

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
      allowPositionals: (this.constructor as typeof AvgCommand).allowPositionals,
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

    if (!process.stdin.isTTY) {
      const text = stripGarbageNewLines(await Bun.stdin.text());
      avgBytes = calcAvgLineLengthBytes(text);
      avgGraphemes = calcAvgLineLength(text);
    } else {
      const sourcePath = positionals[1];
      if (!sourcePath) {
        avgHelp();
        throw createError(appState.s.e.lllm.sourceRequired, { code: "SOURCE_REQUIRED" });
      }
      await validateFiles(sourcePath);

      const text = stripGarbageNewLines(await Bun.file(sourcePath).text());
      avgBytes = calcAvgLineLengthBytes(text);
      avgGraphemes = calcAvgLineLength(text);
    }
    log(
      simpleTemplate(appState.s.m.c.avg.averageCharsPerLine, { AvgChars: avgGraphemes }),
    );
    log(
      simpleTemplate(appState.s.m.c.avg.averageBytesPerLine, { AvgBytes: avgBytes }),
    );

    return 0;
  }
}
