import readline from "node:readline/promises";
import { getFilesToKeep } from "../cmap";
import {
  AppStateSingleton,
  createError,
  customParseArgs as parseArgs,
  generateHelpText,
  log,
  red,
  runConcur,
  yellowBright,
} from "../libs/core";
import { deleteProgressEntry, findAllProgressEntries, stripGarbageNewLines } from "../libs/LLM";
import type { Command } from "../libs/types";

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
      interactive: { type: "boolean", short: "i" },
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

    type Mode = "positional" | "all" | "interactive";
    let mode: Mode;
    if (argValues.all) {
      mode = "all";
    } else if (argValues.interactive) {
      mode = "interactive";
    } else {
      mode = "positional";
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const parseSelectionInput = (input: string, maxIndex: number): number[] => {
      const out = new Set<number>();
      const parts = input
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);

      for (const part of parts) {
        if (/^\d+$/.test(part)) {
          const n = Number(part);
          if (n >= 1 && n <= maxIndex) out.add(n - 1);
        } else if (/^\d+-\d+$/.test(part)) {
          const [aStr, bStr] = part.split("-");
          const a = Number(aStr);
          const b = Number(bStr);
          if (Number.isFinite(a) && Number.isFinite(b)) {
            const start = Math.max(1, Math.min(a, b));
            const end = Math.min(maxIndex, Math.max(a, b));
            for (let i = start; i <= end; i++) out.add(i - 1);
          }
        } else if (part.toLowerCase() === appState.s.m.lcli.a) {
          for (let i = 0; i < maxIndex; i++) out.add(i);
        }
      }
      return Array.from(out).sort((x, y) => x - y);
    };

    const deleteFiles = async (filesToDelete: string[]) => {
      const deleteTasks = filesToDelete.map(
        (file) => () => Bun.file(file).delete(),
      );
      await runConcur(deleteTasks, { concurrency: 64 });
      log(yellowBright(appState.s.m.c.rm.filesDeletedSuccessfully));
    };

    try {
      switch (mode) {
        case "all": {
          const [formattedFileNamesList, jsonFiles] = await findAllProgressEntries(getFilesToKeep());
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

          const answer = (await rl.question(red(appState.s.m.lcli.deletionConfirm)))
            .trim()
            .toLowerCase();
          if (answer === appState.s.m.lcli.yN) {
            await deleteFiles(jsonFiles);
          } else {
            log(red(appState.s.m.lcli.deletionAborted));
          }
          return 0;
        }

        case "interactive": {
          const [formattedFileNamesList, jsonFiles] = await findAllProgressEntries(getFilesToKeep());
          if (jsonFiles.length === 0) {
            throw createError(appState.s.m.c.rm.noFilesToDelete, {
              code: "NO_PROGRESS_FILES",
            });
          }

          log(red(appState.s.m.c.rm.filesToDelete));
          formattedFileNamesList.forEach((line, idx) => {
            log(`${idx + 1}. ${line}`);
          });

          const prompt = appState.s.m.c.rm.filesToDeletePrompt;
          const raw = (await rl.question(prompt)).trim();

          if (!raw || raw.toLowerCase() === appState.s.m.lcli.q) {
            log(red(appState.s.m.lcli.deletionAborted));
            return 0;
          }

          let selectedIndices: number[] = [];
          if (raw.toLowerCase() === appState.s.m.lcli.a) {
            selectedIndices = Array.from(Array(jsonFiles.length).keys());
          } else {
            selectedIndices = parseSelectionInput(raw, jsonFiles.length);
            if (selectedIndices.length === 0) {
              log(red(appState.s.m.c.rm.noValidSelectionsMade));
              return 0;
            }
          }

          const selectedFiles = selectedIndices.map((i) => jsonFiles[i]).filter((f): f is string => !!f);
          log(appState.s.m.c.rm.filesSelectedForDeletion);
          selectedFiles.forEach((f, idx) => log(`  ${idx + 1}. ${f}`));

          if (argValues.force) {
            await deleteFiles(selectedFiles);
            return 0;
          }

          const confirm = (await rl.question(red(appState.s.m.lcli.deletionConfirm))).trim().toLowerCase();
          if (confirm === appState.s.m.lcli.yN) {
            await deleteFiles(selectedFiles);
          } else {
            log(red(appState.s.m.lcli.deletionAborted));
          }

          return 0;
        }

        case "positional": {
          if (!positionals[1]) {
            rmHelp();
            throw createError(appState.s.e.lllm.sourceRequired, { code: "SOURCE_REQUIRED" });
          }
          const sourcePath = positionals[1];

          const text = await Bun.file(sourcePath).text();
          const hash = Bun.hash(stripGarbageNewLines(text)).toString();

          const deleteEntry = async () => {
            log(yellowBright(await deleteProgressEntry(hash)));
          };

          if (argValues.force) {
            await deleteEntry();
            return 0;
          }

          const answer = (await rl.question(red(appState.s.m.lcli.deletionConfirm)))
            .trim()
            .toLowerCase();
          if (answer === appState.s.m.lcli.yN) {
            await deleteEntry();
          } else {
            log(red(appState.s.m.lcli.deletionAborted));
          }
          return 0;
        }

        default: {
          throw createError(appState.s.e.c.rm.unknownMode, { code: "UNKNOWN_MODE" });
        }
      }
    } finally {
      try {
        rl.close();
      } catch {
      }
    }
  }
}
