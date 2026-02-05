import enUS from "../data/i18n/en-US.json" with { type: "json" };
import type {
  CommandConstructor,
  LanguageStrings,
} from "./libs/types/index.ts";

const localeLoaderMap: Record<string, () => Promise<Partial<LanguageStrings>>> =
  {
    // eslint-disable-next-line @typescript-eslint/require-await
    "en-US": async () => enUS as Partial<LanguageStrings>,
    "fr-FR": () =>
      import("../data/i18n/fr-FR.json", { with: { type: "json" } }).then(
        (m) => m.default as Partial<LanguageStrings>,
      ),
    "ja-JP": () =>
      import("../data/i18n/ja-JP.json", { with: { type: "json" } }).then(
        (m) => m.default as Partial<LanguageStrings>,
      ),
    "zh-CN": () =>
      import("../data/i18n/zh-CN.json", { with: { type: "json" } }).then(
        (m) => m.default as Partial<LanguageStrings>,
      ),
  };

export function getFilesToKeep(): string[] {
  return ["config.json", "locale.json"];
}

export function getLocaleInfoMap() {
  return {
    "en-US": {
      name: "English (United States)",
      path: "../data/i18n/en-US.json",
      defaultForLanguage: true,
    },
    "fr-FR": {
      name: "Français (France)",
      path: "../data/i18n/fr-FR.json",
      defaultForLanguage: true,
    },
    "ja-JP": {
      name: "日本語 (日本)",
      path: "../data/i18n/ja-JP.json",
      defaultForLanguage: true,
    },
    "zh-CN": {
      name: "简体中文 (中国)",
      path: "../data/i18n/zh-CN.json",
      defaultForLanguage: true,
    },
  } as const;
}

export async function loadLocaleData(
  locale: string,
): Promise<Partial<LanguageStrings> | null> {
  const loader = localeLoaderMap[locale];

  if (!loader) {
    return null;
  }

  try {
    return await loader();
  } catch (err) {
    console.error(`Failed to load locale data for ${locale}:`, err);
    return null;
  }
}

export async function getCommand(
  key: true,
): Promise<Record<string, () => Promise<CommandConstructor>>>;
export async function getCommand(
  key: string,
): Promise<CommandConstructor | undefined>;
export async function getCommand(
  key: string | true,
): Promise<
  | CommandConstructor
  | undefined
  | Record<string, () => Promise<CommandConstructor>>
> {
  const commandMap = {
    tr: () => import("./commands/translatecommand.ts").then((m) => m.default),
    tf: () => import("./commands/transformcommand.ts").then((m) => m.default),
    bg: () => import("./commands/batchgencommand.ts").then((m) => m.default),
    rm: () => import("./commands/rmcommand.ts").then((m) => m.default),
    st: () => import("./commands/stripcommand.ts").then((m) => m.default),
    avg: () => import("./commands/avgcommand.ts").then((m) => m.default),
    tc: () => import("./commands/tccommand.ts").then((m) => m.default),
    mg: () => import("./commands/mergecommand.ts").then((m) => m.default),
    sp: () => import("./commands/splitcommand.ts").then((m) => m.default),
    cfg: () => import("./commands/configcommand.ts").then((m) => m.default),
    os: () => import("./commands/oneshotcommand.ts").then((m) => m.default),
    help: () => import("./commands/helpcommand.ts").then((m) => m.default),
    rd: () => import("./commands/rdcommand.ts").then((m) => m.default),
    co: () => import("./commands/completions.ts").then((m) => m.default),
  } as const;

  if (key === true) {
    return commandMap;
  }

  const loader = commandMap[key as keyof typeof commandMap];
  return loader ? await loader() : undefined;
}

export { enUS };
export type EnUsStrings = typeof enUS;
