import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../types/index.ts";
import { simpleTemplate } from "./CLI.ts";
import { AppStateSingleton, createError, isEnoentError } from "./context.ts";

export let config: AppConfig;

function normalizeConfigString(str: string): string {
  return str.replace(/\r\n|\r/g, "\n");
}

function processConfigTemplates(configObject: AppConfig): void {
  const templates = configObject.TEMPLATES;
  const lookupMap = (templates || {}) as Record<string, unknown>;
  configObject.TEMPLATES = {};

  const templateRegex = /{{(\w+)}}/g;
  const stack: unknown[] = [configObject];

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;

    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string") {
        let newValue = normalizeConfigString(value);

        if (templates) {
          newValue = newValue.replace(
            templateRegex,
            (match: string, templateKey: string) => {
              if (
                Object.prototype.hasOwnProperty.call(lookupMap, templateKey)
              ) {
                const replacement = lookupMap[templateKey];
                if (typeof replacement === "string") {
                  return normalizeConfigString(replacement);
                }
              }
              return match;
            },
          );
        }

        if (newValue !== value) {
          (current as Record<string, unknown>)[key] = newValue;
        }
      } else if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }

  configObject.TEMPLATES = templates;
}

async function loadTemplateConfig(): Promise<AppConfig> {
  const templateURL = new URL(
    "../../../data/config/template.config.json",
    import.meta.url,
  );
  const templateRaw = await readFile(templateURL, "utf-8");
  return JSON.parse(templateRaw) as AppConfig;
}

export async function configInit(
  isInteractive: boolean,
): Promise<AppStateSingleton> {
  const appState = await AppStateSingleton.init(isInteractive);
  const USER_CONFIG_FILENAME = "config.json";
  const USER_CONFIG_PATH = path.join(appState.STATE_DIR, USER_CONFIG_FILENAME);

  try {
    let loadedConfig: AppConfig;

    try {
      const loadedConfigStr = await readFile(USER_CONFIG_PATH, "utf-8");
      loadedConfig = JSON.parse(loadedConfigStr) as AppConfig;
    } catch (err) {
      if (isEnoentError(err)) {
        await mkdir(path.dirname(USER_CONFIG_PATH), { recursive: true });

        const templateConfig = await loadTemplateConfig();
        const defaultConfig = structuredClone(templateConfig);

        await writeFile(
          USER_CONFIG_PATH,
          appState.stringifyReadable(defaultConfig),
        );

        loadedConfig = defaultConfig;
      } else {
        throw err;
      }
    }

    processConfigTemplates(loadedConfig);
    config = loadedConfig;
    return appState;
  } catch (err) {
    throw createError(
      simpleTemplate(appState.s.e.lcli.cfgCouldNotBeLoaded, {
        UserConfigPath: USER_CONFIG_PATH,
      }),
      { cause: err, code: "CONFIG_LOAD_FAILED" },
    );
  }
}
