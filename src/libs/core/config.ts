import { mkdir } from "node:fs/promises";
import path from "node:path";
import templateConfig from "../../../data/config/template.config.json" with { type: "file" };
import type { AppConfig } from "../types";
import { log, simpleTemplate } from "./CLI";
import { AppStateSingleton, createError } from "./context";

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
    const fileExists = await Bun.file(USER_CONFIG_PATH).exists();

    if (!fileExists) {
      log(
        simpleTemplate(appState.s.m.lcli.userConfigNotFound, { UserConfigPath: USER_CONFIG_PATH }),
      );
      await mkdir(path.dirname(USER_CONFIG_PATH), { recursive: true });
      const templateContent = await Bun.file(templateConfig as unknown as string).bytes();
      await Bun.write(USER_CONFIG_PATH, templateContent);

      log(appState.s.m.lcli.cfgCreatedSuccessfully);
    }

    const loadedConfig = await Bun.file(USER_CONFIG_PATH).json();
    processConfigTemplates(loadedConfig);
    config = loadedConfig;
    return appState;
  } catch (err) {
    throw createError(
      simpleTemplate(appState.s.e.lcli.cfgCouldNotBeLoaded, { UserConfigPath: USER_CONFIG_PATH }),
      { cause: err, code: "CONFIG_LOAD_FAILED" },
    );
  }
}
