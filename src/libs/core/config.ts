import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../types/index.ts";
import { simpleTemplate } from "./CLI.ts";
import { AppStateSingleton, createError, isEnoentError } from "./context.ts";

export let config: AppConfig;

function processConfigTemplates(configObject: AppConfig): void {
  const templates = configObject.TEMPLATES;
  delete configObject.TEMPLATES;
  if (!templates || typeof templates !== "object") {
    return;
  }

  const templateRegex = /^{{(\w+)}}$/;

  const stack: unknown[] = [configObject];

  while (stack.length > 0) {
    const current = stack.pop();

    if (current === null || typeof current !== "object") continue;

    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string") {
        const match = value.match(templateRegex);
        const templateKey = match?.[1];
        if (templateKey && templates[templateKey] !== undefined) {
          (current as Record<string, unknown>)[key] = templates[templateKey];
        }
      } else if (typeof value === "object" && value !== null) {
        stack.push(value);
      }
    }
  }
}

export async function configInit(cli: boolean): Promise<AppStateSingleton> {
  const appState = await AppStateSingleton.init(cli);
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

        const { default: templateConfig } = await import(
          "../../../data/config/template.config.json",
          { with: { type: "json" } }
        );

        const defaultConfig = JSON.parse(
          JSON.stringify(templateConfig),
        ) as unknown as AppConfig;

        await writeFile(
          USER_CONFIG_PATH,
          JSON.stringify(defaultConfig, null, 2),
        );
        loadedConfig = defaultConfig as unknown as AppConfig;
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
