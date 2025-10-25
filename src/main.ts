import { getCommand } from "./cmap";
import {
  configInit,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  isNodeError,
  log,
  red,
  simpleTemplate,
} from "./libs/core";
import type { AppState } from "./libs/types";

let appState: AppState;

export async function applyCommand(commandAlias: string, argv: string[]): Promise<void> {
  if (commandAlias === "_default") commandAlias = "help";

  const CommandClass = await getCommand(commandAlias);
  if (!CommandClass) {
    exitOne();
    errlog(red(simpleTemplate(appState.s.e.lcli.commandNotImplemented, { CommandAlias: commandAlias })));
    return;
  }

  const commandInstance = new CommandClass();
  await commandInstance.execute(argv);
}

export async function main(argv?: string[], cli: boolean = true): Promise<number> {
  let deb = false;
  try {
    appState = await configInit(cli);
    const args = argv ?? process.argv.slice(2);
    const globalOptions = {
      version: { type: "boolean" },
      debug: { type: "boolean", short: "d" },
    } as const;
    const parsedGlobalArgs = parseArgs({
      options: globalOptions,
      strict: false,
      args,
      allowPositionals: true,
    });
    if (parsedGlobalArgs.values["version"]) {
      log(red(`${appState.P_NAME}: ${appState.P_VERSION}`));
      return 0;
    }
    deb = !!parsedGlobalArgs.values["debug"];
    if (deb) {
      appState.setDebug();
    }
    const cmdAlias = parsedGlobalArgs.positionals[0] ?? "_default";
    await applyCommand(cmdAlias, args);
    return 0;
  } catch (err) {
    exitOne();
    if (isNodeError(err)) {
      errlog(red(err.message));
      if (isNodeError(err.cause)) {
        errlog(
          red(`>${appState.s.e.lcli.causePrefix} ${err.cause.message ?? JSON.stringify(err.cause)}`),
        );
      }
      if (deb && err.stack) {
        errlog(err.stack);
      }
    } else {
      errlog(red(String(err)));
    }
    return 1;
  }
}
