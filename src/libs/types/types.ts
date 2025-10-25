import type enUS from "../../../data/i18n/en-US.json";

export interface AppState {
  readonly P_NAME: string;
  readonly P_VERSION: string;
  readonly HOME_DIR: string;
  readonly STATE_DIR: string;
  readonly DEBUG_MODE: boolean;
  readonly isCLI: boolean;
  readonly LIST_INDENT_WIDTH: number;
  readonly TERMINAL_WIDTH: number;
  readonly SEPARATOR: string;
  readonly supportedLocaleSet: Set<string>;
  readonly languageToLocaleMap: Map<string, string>;
  readonly s: LanguageStrings;

  getStateDirPath(appName: string): string;
  getUserLocale(): Promise<string | null>;
  isValidLocale(locale: string): boolean;
  findBestSupportedLocale(localeString: string | undefined | null): string | null;
  getLocale(): Promise<string>;
  setDebug(): boolean;
}

export type ErrOpts = {
  level: "warn" | "error" | "critical";
};

export interface CreateErrorOptions {
  cause?: unknown;
  code?: string;
  immediateExitCode?: boolean;
}

export interface NodeError extends Error {
  code?: string;
}

export interface CustomOptionConfig {
  type: "string" | "boolean";
  short?: string;
  default?: string | boolean;
}

export interface CustomParseArgsConfig<
  T extends { options?: { [longOption: string]: CustomOptionConfig } },
> {
  args?: string[];
  options?: T["options"];
  allowPositionals?: boolean;
  strict?: boolean;
}

type OptionValue<O extends CustomOptionConfig> = O["type"] extends "string" ? string : boolean;
type OptionsWithDefaults<T extends CustomParseArgsConfig<any>> = {
  [K in keyof T["options"] as T["options"][K] extends { default: any } ? K : never]: OptionValue<T["options"][K]>;
};
type OptionsWithoutDefaults<T extends CustomParseArgsConfig<any>> = {
  [K in keyof T["options"] as T["options"][K] extends { default: any } ? never : K]?: OptionValue<T["options"][K]>;
};
export interface CustomParsedResults<T extends CustomParseArgsConfig<any>> {
  values: OptionsWithDefaults<T> & OptionsWithoutDefaults<T>;
  positionals: string[];
}

export interface Command {
  execute(argv: string[]): Promise<number | void>;
}

export type CommandModule = {
  default: new() => Command;
};

export type PositionalCompletion = "file" | "directory" | "none";

type CommandOptionConfig = CustomOptionConfig & {
  completions?: readonly string[];
};

export interface CommandConstructor {
  new(): Command;
  options: Record<string, CommandOptionConfig>;
  allowPositionals?: boolean;
  positionalCompletion?: PositionalCompletion;
  helpReplacements?: Record<string, string>;
}
export type NumConstraints = {
  min?: number;
  max?: number;
  minExclusive?: number;
  maxExclusive?: number;
  integer?: boolean;
  isFloat?: boolean;
  allowNaN?: boolean;
};
export type StrConstraints = { notEmpty?: boolean };
export type DelayTuple = [isProcessed: boolean, value: number];

export interface FormatAlignedListOptions {
  terminalWidth?: number;
  columnGap?: number;
  firstColumnSeparator?: string;
  forceFirstColumnWidth?: number;
  listIndentWidth?: number;
}

interface BaseHelpSection {
  usage: string;
  flags?: Record<string, string>;
  footer?: string;
}

export interface HelpSection extends BaseHelpSection {
  description: string;
}

export interface GenericHelpSection extends BaseHelpSection {
  header: string;
  commandHeader: string;
  commandDescriptions: Record<string, string>;
  globalOptionsHeader: string;
}

export interface RunConcurOpts {
  concurrency?: number;
  allSettled?: boolean;
}

export type LanguageStrings = typeof enUS;
