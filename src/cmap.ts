import deDEPath from "../data/i18n/de-DE.json" with { type: "file" };
import enUSPath from "../data/i18n/en-US.json" with { type: "file" };
import esESPath from "../data/i18n/es-ES.json" with { type: "file" };
import frFRPath from "../data/i18n/fr-FR.json" with { type: "file" };
import itITPath from "../data/i18n/it-IT.json" with { type: "file" };
import jaJPPath from "../data/i18n/ja-JP.json" with { type: "file" };
import koKRPath from "../data/i18n/ko-KR.json" with { type: "file" };
import ruRUPath from "../data/i18n/ru-RU.json" with { type: "file" };
import zhCNPath from "../data/i18n/zh-CN.json" with { type: "file" };
import type { CommandConstructor, LanguageStrings } from "./libs/types";

export function getFilesToKeep(): string[] {
  return ["config.json", "locale.json"];
}

export function getLocaleInfoMap() {
  return {
    "en-US": { name: "English (United States)", path: (enUSPath as unknown) as string, defaultForLanguage: true },
    "de-DE": { name: "Deutsch (Deutschland)", path: (deDEPath as unknown) as string, defaultForLanguage: true },
    "es-ES": { name: "Español (España)", path: (esESPath as unknown) as string, defaultForLanguage: true },
    "fr-FR": { name: "Français (France)", path: (frFRPath as unknown) as string, defaultForLanguage: true },
    "ja-JP": { name: "日本語 (日本)", path: (jaJPPath as unknown) as string, defaultForLanguage: true },
    "ru-RU": { name: "Русский (Россия)", path: (ruRUPath as unknown) as string, defaultForLanguage: true },
    "zh-CN": { name: "简体中文 (中国)", path: (zhCNPath as unknown) as string, defaultForLanguage: true },
    "ko-KR": { name: "한국어 (한국)", path: (koKRPath as unknown) as string, defaultForLanguage: true },
    "it-IT": { name: "Italiano (Italia)", path: (itITPath as unknown) as string, defaultForLanguage: true },
  } as const;
}

export function loadLocaleData(
  locale: string,
): Promise<Partial<LanguageStrings> | null> {
  const localeInfoMap = getLocaleInfoMap();
  if (!(locale in localeInfoMap)) {
    return Promise.resolve(null);
  }

  const internalPath = localeInfoMap[locale as keyof typeof localeInfoMap].path;

  return Bun.file(internalPath).json();
}

export async function getCommand(key: true): Promise<Record<string, () => Promise<CommandConstructor>>>;
export async function getCommand(key: string): Promise<CommandConstructor | undefined>;
export async function getCommand(
  key: string | true,
): Promise<
  CommandConstructor | undefined | Record<string, () => Promise<CommandConstructor>>
> {
  const commandMap = {
    tr: () => import("./commands/translatecommand").then(m => m.default),
    tf: () => import("./commands/transformcommand").then(m => m.default),
    bg: () => import("./commands/batchgencommand").then(m => m.default),
    rm: () => import("./commands/rmcommand").then(m => m.default),
    st: () => import("./commands/stripcommand").then(m => m.default),
    avg: () => import("./commands/avgcommand").then(m => m.default),
    tc: () => import("./commands/tccommand").then(m => m.default),
    mg: () => import("./commands/mergecommand").then(m => m.default),
    sp: () => import("./commands/splitcommand").then(m => m.default),
    cfg: () => import("./commands/configcommand").then(m => m.default),
    os: () => import("./commands/oneshotcommand").then(m => m.default),
    help: () => import("./commands/helpcommand").then(m => m.default),
    co: () => import("./commands/cocommand").then(m => m.default),
    lu: () => import("./commands/launchcommand").then(m => m.default),
    ch: () => import("./commands/chatcommand").then(m => m.default),
  } as const;

  if (key === true) {
    return commandMap;
  }

  const loader = commandMap[key as keyof typeof commandMap];
  return loader ? await loader() : undefined;
}
