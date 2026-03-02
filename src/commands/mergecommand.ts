import {
  AppStateSingleton,
  createError,
  errlog,
  exitOne,
  generateHelpText,
  log,
  customParseArgs as parseArgs,
  red,
} from "../libs/core/index.ts";
import { mergeFiles } from "../libs/LLM/index.ts";
import type { Command } from "../libs/types/index.ts";

export default class MergeCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "directory" as const;
  }
  static get options() {
    return {
      extension: { type: "string", short: "e" },
      help: { type: "boolean", short: "h" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: (this.constructor as typeof MergeCommand).options,
      allowPositionals: (this.constructor as typeof MergeCommand)
        .allowPositionals,
      strict: true,
    });
    const mergeHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.mg,
        (this.constructor as typeof MergeCommand).options,
      );
      log(helpText);
    };
    if (argValues.help) {
      mergeHelp();
      return 0;
    }
    if (!positionals[1]) {
      exitOne();
      mergeHelp();
      throw createError(appState.s.e.lllm.sourceRequired, {
        code: "SOURCE_REQUIRED",
      });
    }
    const sourcePath = positionals[1];
    const targetPath = positionals[2] ? positionals[2] : process.cwd();
    const extension = argValues.extension;
    if (!extension) {
      exitOne();
      errlog(red(appState.s.e.c.mg.extensionRequired));
      return 1;
    }

    await mergeFiles(sourcePath, targetPath, extension);

    return 0;
  }
}
