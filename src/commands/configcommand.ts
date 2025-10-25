import path from "node:path";
import { createInterface } from "node:readline/promises";
import { getLocaleInfoMap } from "../cmap";
import {
  AppStateSingleton,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  generateHelpText,
  generateLocaleList,
  isNodeError,
  log,
  red,
  runConcur,
  simpleTemplate,
  yellowBright,
} from "../libs/core";
import type { Command } from "../libs/types";

export function openWith(filePath: string) {
  const appState = AppStateSingleton.getInstance();
  const editor = process.env["EDITOR"];

  if (!editor) {
    errlog({ level: "warn" }, yellowBright(`${appState.s.e.c.cfg.editorNotFound}`));
    return;
  }

  try {
    Bun.spawn([editor, filePath], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    errlog(
      red(
        simpleTemplate(appState.s.e.c.cfg.editorLaunchFailed, { ErrorMessage: errorMessage }),
      ),
    );
  }
}

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
      allowPositionals: (this.constructor as typeof CfgCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof CfgCommand).options,
    });

    const hasArguments = Object.keys(argValues).some((key) => {
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
      const replacements = { LocaleList: generateLocaleList(getLocaleInfoMap()) };

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
      openWith(cfgPath);
      return 0;
    }
    if (argValues.remove) {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      log(red(`${cfgPath}`));

      const localeExists = await Bun.file(localePath).exists();
      if (localeExists) {
        log(red(`${localePath}`));
      }

      const answer = await rl.question(appState.s.m.lcli.deletionConfirm);
      rl.close();
      if (answer.trim().toLowerCase() === appState.s.m.lcli.yN) {
        const deleteTasks = [
          () => Bun.file(cfgPath).delete(),
        ];
        if (localeExists) {
          deleteTasks.push(() => Bun.file(localePath).delete());
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
          await Bun.write(localePath, JSON.stringify(localeData, null, 2));
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
        errlog(red(simpleTemplate(appState.s.e.c.cfg.invalidLocale, { Lang: lang })));
        return 1;
      }
    }
    return 0;
  }
}
