import { readFile, unlink } from "node:fs/promises";
import readline from "node:readline/promises";
import { getFilesToKeep } from "../cmap.ts";
import {
  AppStateSingleton,
  createError,
  fastHash,
  generateHelpText,
  log,
  customParseArgs as parseArgs,
  red,
  runConcur,
  yellowBright,
} from "../libs/core/index.ts";
import {
  deleteProgressEntry,
  findAllProgressEntries,
  validateFiles,
} from "../libs/LLM/index.ts";
import type { Command } from "../libs/types/index.ts";

export default class RMCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get options() {
    return {
      help: { type: "boolean", short: "h" },
      all: { type: "boolean", short: "a" },
      force: { type: "boolean", short: "f" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof RMCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof RMCommand).options,
    });

    const rmHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.rm,
        (this.constructor as typeof RMCommand).options,
      );
      log(helpText);
    };

    if (argValues.help) {
      rmHelp();
      return 0;
    }

    if (!appState.isInteractive && !argValues.force) {
      throw createError(appState.s.e.lcli.notInteractive, {
        code: "INTERACTIVE_NOT_SUPPORTED",
      });
    }

    const deleteFiles = async (filesToDelete: string[]) => {
      const deleteTasks = filesToDelete.map((file) => () => unlink(file));
      await runConcur(deleteTasks, { concurrency: 64 });
      log(yellowBright(appState.s.m.c.rm.filesDeletedSuccessfully));
    };

    if (argValues.all) {
      const [formattedFileNamesList, jsonFiles] =
        await findAllProgressEntries(getFilesToKeep());
      if (jsonFiles.length === 0) {
        throw createError(appState.s.m.c.rm.noFilesToDelete, {
          code: "NO_PROGRESS_FILES",
        });
      }

      log(red(appState.s.m.c.rm.filesToDelete));
      log(formattedFileNamesList.join("\n"));

      if (argValues.force) {
        await deleteFiles(jsonFiles);
        return 0;
      }

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        const answer = (
          await rl.question(red(appState.s.m.lcli.deletionConfirm))
        )
          .trim()
          .toLowerCase();
        if (answer === appState.s.m.lcli.yN) {
          await deleteFiles(jsonFiles);
        } else {
          log(red(appState.s.m.lcli.deletionAborted));
        }
      } finally {
        rl.close();
      }
      return 0;
    }

    if (!positionals[1]) {
      rmHelp();
      throw createError(appState.s.e.lllm.sourceRequired, {
        code: "SOURCE_REQUIRED",
      });
    }

    const sourcePath = positionals[1];
    await validateFiles(sourcePath);

    const text = await readFile(sourcePath, "utf-8");
    const hash = fastHash(text);

    const deleteEntry = async () => {
      log(yellowBright(await deleteProgressEntry(hash)));
    };

    if (argValues.force) {
      await deleteEntry();
      return 0;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    try {
      const answer = (await rl.question(red(appState.s.m.lcli.deletionConfirm)))
        .trim()
        .toLowerCase();
      if (answer === appState.s.m.lcli.yN) {
        await deleteEntry();
      } else {
        log(red(appState.s.m.lcli.deletionAborted));
      }
    } finally {
      rl.close();
    }

    return 0;
  }
}
