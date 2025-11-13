import { AppStateSingleton, customParseArgs as parseArgs, generateHelpText, log } from "../libs/core";
import type { Command } from "../libs/types";

export default class HelpCommand implements Command {
  static get allowPositionals() {
    return false;
  }
  static get positionalCompletion() {
    return "none" as const;
  }
  static get options() {
    return {};
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    parseArgs({
      args: argv.slice(1),
      allowPositionals: (this.constructor as typeof HelpCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof HelpCommand).options,
    });
    const helpText = generateHelpText(appState.s.help.generic);
    log(helpText);
    return 0;
  }
}
