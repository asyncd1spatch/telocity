import {
  AppStateSingleton,
  createError,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  generateHelpText,
  log,
  red,
  simpleTemplate,
} from "../libs/core";
import { splitFile } from "../libs/LLM";
import type { Command } from "../libs/types";

export const defaultSize = "0.08";

export default class SplitCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return { Size: defaultSize };
  }
  static get options() {
    return {
      size: { type: "string", short: "s", default: defaultSize },
      help: { type: "boolean", short: "h" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: (this.constructor as typeof SplitCommand).options,
      allowPositionals: (this.constructor as typeof SplitCommand).allowPositionals,
      strict: true,
    });

    const splitHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.sp,
        (this.constructor as typeof SplitCommand).options,
        { Size: argValues.size },
      );
      log(helpText);
    };

    if (argValues.help) {
      splitHelp();
      return 0;
    }

    if (!positionals[1] || !positionals[2]) {
      exitOne();
      splitHelp();
      errlog(red(appState.s.e.lllm.sourceTargetRequired));
      return 1;
    }
    const sourcePath = positionals[1];
    const targetPath = positionals[2];
    const size = Number(argValues.size);

    if (isNaN(size) || size <= 0) {
      throw createError(
        simpleTemplate(appState.s.e.c.sp.invalidSplitSize, { Size: argValues.size }),
        { code: "INVALID_SPLIT_SIZE" },
      );
    }

    const partPaths = await splitFile(sourcePath, targetPath, size);

    log(simpleTemplate(appState.s.m.c.sp.fileSplitSuccess, { SourcePath: sourcePath }));

    partPaths.forEach((partPath, index) => {
      log(
        simpleTemplate(appState.s.m.c.sp.partCreated, {
          PartNumber: index + 1,
          PartPath: partPath,
        }),
      );
    });
    return 0;
  }
}
