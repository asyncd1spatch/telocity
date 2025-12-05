import { spawn } from "node:child_process";
import { stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getLocaleInfoMap } from "../cmap.ts";
import {
  AppStateSingleton,
  errlog,
  exitOne,
  generateHelpText,
  generateLocaleList,
  isEnoentError,
  isNodeError,
  log,
  customParseArgs as parseArgs,
  red,
  runConcur,
  simpleTemplate,
  yellowBright,
} from "../libs/core/index.ts";
import type { Command } from "../libs/types/index.ts";

export default class CfgCommand implements Command {
  static get allowPositionals() {
    return false;
  }
  static get positionalCompletion() {
    return "none" as const;
  }
  static get options() {
    return {
      help: { type: "boolean", short: "h" },
      edit: { type: "boolean", short: "e" },
      remove: { type: "boolean", short: "r" },
      lang: { type: "string", short: "l" },
    } as const;
  }

  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv.slice(1),
      allowPositionals: (this.constructor as typeof CfgCommand)
        .allowPositionals,
      strict: true,
      options: (this.constructor as typeof CfgCommand).options,
    });

    const hasArguments =
      Object.keys(argValues).some((key) => {
        const value = argValues[key as keyof typeof argValues];
        if (typeof value === "boolean") {
          return value === true;
        }
        if (typeof value === "string") {
          return value !== "";
        }
        return value !== undefined && value !== null;
      }) || positionals.length > 1;

    if (!hasArguments || argValues.help) {
      const replacements = {
        LocaleList: generateLocaleList(getLocaleInfoMap()),
      };

      const helpText = generateHelpText(
        appState.s.help.commands.cfg,
        (this.constructor as typeof CfgCommand).options,
        replacements,
      );
      log(helpText);
      return 0;
    }

    const cfgPath = path.join(appState.STATE_DIR, "config.json");
    const localePath = path.join(appState.STATE_DIR, "locale.json");

    if (argValues.edit) {
      log(`${cfgPath}`);

      let editor = process.env["EDITOR"];

      if (!editor) {
        const defaultEditors = [
          "code",
          "code-insiders",
          "codium",
          "zed",
          "subl",
          "notepad",
          "gedit",
          "kate",
          "kwrite",
          "mousepad",
          "leafpad",
          "micro",
          "nano",
          "nvim",
          "vim",
          "emacs",
          "sensible-editor",
          "vi",
        ];

        const checkCommand = (cmd: string): Promise<boolean> => {
          return new Promise((resolve) => {
            const checkCmd =
              process.platform === "win32" ? "where" : "command -v";
            const fullCommand = `${checkCmd} "${cmd}"`;

            const child = spawn(fullCommand, { stdio: "ignore", shell: true });
            child.on("close", (code) => resolve(code === 0));
            child.on("error", () => resolve(false));
          });
        };

        for (const candidate of defaultEditors) {
          if (await checkCommand(candidate)) {
            editor = candidate;
            break;
          }
        }
      }

      if (!editor) {
        errlog(
          { level: "warn" },
          yellowBright(`${appState.s.e.c.cfg.editorNotFound}`),
        );
        return 1;
      }

      try {
        const launchCommand = `${editor} "${cfgPath}"`;

        const child = spawn(launchCommand, {
          stdio: "inherit",
          shell: true,
          detached: true,
        });
        child.unref();
      } catch {
        /* nothing */
      }

      return 0;
    }

    if (argValues.remove) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      log(red(`${cfgPath}`));

      let localeFileFound = false;
      try {
        await stat(localePath);
        localeFileFound = true;
        log(red(`${localePath}`));
      } catch {
        // Ignore if stat fails, just don't list it
      }

      const answer = await rl.question(appState.s.m.lcli.deletionConfirm);
      rl.close();
      if (answer.trim().toLowerCase() === appState.s.m.lcli.yN) {
        const safeDelete = async (p: string) => {
          try {
            await unlink(p);
          } catch (err) {
            if (!isEnoentError(err)) throw err;
          }
        };

        const deleteTasks = [() => safeDelete(cfgPath)];
        if (localeFileFound) {
          deleteTasks.push(() => safeDelete(localePath));
        }

        await runConcur(deleteTasks);

        log(yellowBright(appState.s.m.c.cfg.cfgDeletedSuccessfully));
        return 0;
      }
      log(appState.s.m.lcli.deletionAborted);
      return 0;
    }
    const lang = argValues.lang;
    if (lang) {
      if (appState.isValidLocale(lang)) {
        const localeData = { locale: argValues.lang };
        try {
          await writeFile(localePath, JSON.stringify(localeData, null, 2));
          log(
            simpleTemplate(appState.s.m.c.cfg.localeSuccessfullyChanged, {
              Locale: argValues.lang ?? "",
            }),
          );
          return 0;
        } catch (err) {
          if (isNodeError(err)) {
            exitOne();
            errlog(
              red(
                simpleTemplate(appState.s.e.c.cfg.failedToWriteLocale, {
                  ErrorMessage: `${err?.message}`,
                }),
              ),
            );
            return 1;
          }
        }
      } else {
        errlog(
          red(simpleTemplate(appState.s.e.c.cfg.invalidLocale, { Lang: lang })),
        );
        return 1;
      }
    }
    return 0;
  }
}
