import { homedir } from "node:os";
import path from "node:path";
import packageJsonF from "../../../package.json" with { type: "file" };
import { getLocaleInfoMap, loadLocaleData } from "../../cmap";
import { AppState, CreateErrorOptions, ErrOpts, LanguageStrings, NodeError } from "../types";

export class AppStateSingleton implements AppState {
  private static _instance: AppStateSingleton | null = null;

  private _P_NAME: string = "";
  private _P_VERSION: string = "";
  private _HOME_DIR: string = "";
  private _STATE_DIR: string = "";
  private _DEBUG_MODE: boolean = false;
  private _isCLI: boolean = false;
  private _LIST_INDENT_WIDTH: number = 2;
  private _TERMINAL_WIDTH: number = 80;
  private _SEPARATOR: string = " - ";
  private _supportedLocaleSet!: Set<string>;
  private _languageToLocaleMap!: Map<string, string>;
  private _s: LanguageStrings = null!;

  private constructor() {
  }

  public static getInstance(): AppStateSingleton {
    if (!AppStateSingleton._instance) {
      throw new Error(
        "AppStateSingleton has not been initialized. Call AppStateSingleton.init() at the top-level of your application.",
      );
    }
    return AppStateSingleton._instance;
  }

  public static async init(cli: boolean): Promise<AppStateSingleton> {
    let instance;
    if (!cli && AppStateSingleton._instance) {
      instance = AppStateSingleton.getInstance();
    } else {
      if (AppStateSingleton._instance) {
        throw new Error("AppStateSingleton.init() has already been called.");
      }
      AppStateSingleton._instance = new AppStateSingleton();
      instance = AppStateSingleton._instance;
    }

    instance._isCLI = cli;
    instance._HOME_DIR = homedir();

    const packageJson = await Bun.file(packageJsonF as unknown as string).json() as unknown as {
      name: string;
      version: string;
    };

    if (!packageJson.name || !packageJson.version) {
      throw new Error("package.json must contain 'name' and 'version' fields.");
    }

    instance._P_NAME = packageJson.name;
    instance._P_VERSION = packageJson.version;
    instance._STATE_DIR = instance.getStateDirPath(packageJson.name);
    const localeMap = getLocaleInfoMap();
    const supportedLocales = Object.keys(localeMap);
    instance._supportedLocaleSet = new Set(supportedLocales);
    instance._languageToLocaleMap = new Map();

    for (const locale of supportedLocales) {
      const info = localeMap[locale as keyof typeof localeMap];
      if (info?.defaultForLanguage) {
        const langPart = locale.split("-")[0];
        if (langPart) {
          instance._languageToLocaleMap.set(langPart, locale);
        }
      }
    }

    for (const locale of supportedLocales) {
      const langPart = locale.split("-")[0];
      if (langPart && !instance._languageToLocaleMap.has(langPart)) {
        instance._languageToLocaleMap.set(langPart, locale);
      }
    }

    const currentLocale = await instance.getLocale();
    instance._s = await loadStrings(currentLocale);

    return instance;
  }

  public getStateDirPath(appName: string): string {
    const home = this.HOME_DIR;
    switch (process.platform) {
      case "win32": {
        const appDataPath = process.env["APPDATA"];
        if (appDataPath) {
          return path.join(appDataPath, appName);
        }
        return path.join(home, "AppData", "Roaming", appName);
      }
      case "linux": {
        const xdgConfigHome = process.env["XDG_CONFIG_HOME"];
        if (xdgConfigHome) {
          return path.join(xdgConfigHome, appName);
        }
        return path.join(home, ".config", appName);
      }
      case "darwin": {
        return path.join(home, "Library", "Application Support", appName);
      }
      default:
        errlog(
          { level: "warn" },
          `[WARN] Unsupported OS: ${process.platform}. State will be stored in home directory.`,
        );
        return path.join(home, `.${appName}`);
    }
  }

  public async getUserLocale(): Promise<string | null> {
    const localePath = path.join(this.STATE_DIR, "locale.json");
    try {
      const { locale } = (await Bun.file(localePath).json()) as {
        locale: string;
      };

      if (this.isValidLocale(locale)) {
        return locale;
      }
    } catch {
      // Intentionally ignored
    }
    return null;
  }

  public isValidLocale(locale: string): boolean {
    return this.supportedLocaleSet.has(locale);
  }

  public findBestSupportedLocale(
    localeString: string | undefined | null,
  ): string | null {
    const normalized = normalizeLocaleString(localeString);
    if (!normalized) {
      return null;
    }

    if (this.supportedLocaleSet.has(normalized)) {
      return normalized;
    }

    try {
      const parsedInput = new Intl.Locale(normalized);
      const language = parsedInput.language;
      return this.languageToLocaleMap.get(language) || null;
    } catch {
      return null;
    }
  }

  public async getLocale(): Promise<string> {
    const userSetLocale = await this.getUserLocale();
    if (userSetLocale) {
      return userSetLocale;
    }

    const potentialLocaleSources: (string | undefined)[] = [
      process.env["LANG"],
    ];

    const localeCandidates = potentialLocaleSources
      .filter((s): s is string => !!s)
      .flatMap((source) => source.split(/[:\s]+/));

    const foundLocale = localeCandidates
      .map((l) => this.findBestSupportedLocale(l))
      .find((l): l is string => !!l);

    return foundLocale ?? "en-US";
  }

  public setDebug(): boolean {
    return (this._DEBUG_MODE = true);
  }
  public get DEBUG_MODE(): boolean {
    return this._DEBUG_MODE;
  }

  public get P_NAME(): string {
    return this._P_NAME;
  }
  public get P_VERSION(): string {
    return this._P_VERSION;
  }
  public get HOME_DIR(): string {
    return this._HOME_DIR;
  }
  public get STATE_DIR(): string {
    return this._STATE_DIR;
  }
  public get isCLI(): boolean {
    return this._isCLI;
  }
  public get LIST_INDENT_WIDTH(): number {
    return this._LIST_INDENT_WIDTH;
  }
  public get TERMINAL_WIDTH(): number {
    return this._TERMINAL_WIDTH;
  }
  public get SEPARATOR(): string {
    return this._SEPARATOR;
  }
  public get supportedLocaleSet(): Set<string> {
    return this._supportedLocaleSet;
  }
  public get languageToLocaleMap(): Map<string, string> {
    return this._languageToLocaleMap;
  }
  public get s(): LanguageStrings {
    return this._s;
  }
}

function normalizeLocaleString(
  localeString: string | undefined | null,
): string | null {
  if (!localeString || typeof localeString !== "string") return null;
  let cleaned = localeString.split(".")[0];
  cleaned = cleaned?.replace(/_/g, "-");
  return cleaned ?? "";
}

function deepMerge<T extends object>(base: T, override: object): T {
  const output: T = { ...base };
  type IndexableObject = Record<string, unknown>;
  const stack: Array<{ target: IndexableObject; src: IndexableObject }> = [
    { target: output as IndexableObject, src: override as IndexableObject },
  ];

  while (stack.length > 0) {
    const { target, src } = stack.pop()!;

    for (const key in src) {
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;

      const srcValue = src[key];
      const targetValue = target[key];

      if (isObjectNotArray(targetValue) && isObjectNotArray(srcValue)) {
        if (!isObjectNotArray(target[key])) {
          target[key] = {};
        }
        stack.push({ target: targetValue, src: srcValue });
      } else {
        target[key] = srcValue;
      }
    }
  }

  return output;
}

async function loadStrings(locale = "en-US"): Promise<LanguageStrings> {
  const englishStrings = (await loadLocaleData(
    "en-US",
  )) as LanguageStrings | null;

  if (!englishStrings) {
    throw createError(
      "English language file (en-US.json) could not be loaded.",
      { code: "LANGUAGE_LOAD_FAILED" },
    );
  }

  if (locale === "en-US") {
    return englishStrings;
  }

  const localeStrings = await loadLocaleData(locale);

  if (!localeStrings) {
    return englishStrings;
  }

  return deepMerge(englishStrings, localeStrings);
}

export function isNodeError(error: unknown): error is NodeError {
  return error instanceof Error;
}

export function isTypeError(error: unknown): error is TypeError {
  return error instanceof TypeError;
}

export function isEnoentError(
  error: unknown,
): error is NodeError & { code: "ENOENT" } {
  return isNodeError(error) && error.code === "ENOENT";
}

export function isEexistError(
  error: unknown,
): error is NodeError & { code: "EEXIST" } {
  return isNodeError(error) && error.code === "EEXIST";
}

export function exitOne(): void {
  if (process.env.NODE_ENV !== "test") {
    process.exitCode = 1;
  }
}

export function createError(
  message: string,
  options: CreateErrorOptions = {},
): Error {
  const { cause, code, immediateExitCode = true } = options;
  const newError: NodeError = new Error(message, { cause });

  if (code) {
    newError.code = code;
  } else if (isNodeError(cause) && cause.code) {
    newError.code = cause.code;
  }

  if (immediateExitCode) {
    exitOne();
  }

  return newError;
}

export function errlog(
  firstArg: ErrOpts | string | number,
  ...restArgs: unknown[]
): void {
  if (typeof firstArg === "object" && firstArg !== null && "level" in firstArg) {
    const options = firstArg as ErrOpts;
    const msg = restArgs;
    const DEBUG = AppStateSingleton.getInstance().DEBUG_MODE;
    switch (options.level) {
      case "warn":
        if (DEBUG) console.warn("[WARN]", ...msg);
        break;
      case "error":
        console.error("[ERROR]", ...msg);
        break;
      case "critical":
        console.error("[CRITICAL]", ...msg);
        break;
    }
  } else {
    const allMsg = [firstArg, ...restArgs];
    console.error(...allMsg);
  }
}

export function isObjectNotArray(
  item: unknown,
): item is Record<string, unknown> {
  return !!(item && typeof item === "object" && !Array.isArray(item));
}
