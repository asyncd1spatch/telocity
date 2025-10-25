#!/usr/bin/env bun

import { $ } from "bun";
import { stat } from "node:fs/promises";
import * as path from "node:path";

const languages = {
  "de-DE": "German (Germany) [de-DE]",
  "es-ES": "Spanish (Spain) [es-ES]",
  "fr-FR": "French (France) [fr-FR]",
  "ja-JP": "Japanese (Japan) [ja-JP]",
  "ru-RU": "Russian (Russia) [ru-RU]",
  "zh-CN": "Simplified Chinese (China) [zh-CN]",
  "ko-KR": "Korean (Korea) [ko-KR]",
  "it-IT": "Italian (Italy) [it-IT]",
} as const;

const PROJECT_ROOT = process.cwd();
const I18N_DIR = path.join(PROJECT_ROOT, "data", "i18n");
const SOURCE_FILE = path.join(I18N_DIR, "en-US.json");

function cleanTranslatedJson(rawContent: string): string {
  return rawContent
    .trim()
    .replace(/^(?:```(?:json)?|\[[^\]]+\])\s*/, "")
    .replace(/```\s*$/, "")
    .trim();
}

async function translationTask() {
  try {
    await stat(I18N_DIR);
  } catch {
    console.error(`Error: i18n directory not found at ${I18N_DIR}`);
    process.exit(1);
  }

  try {
    await stat(SOURCE_FILE);
  } catch {
    console.error(`Error: Source file not found at ${SOURCE_FILE}`);
    process.exit(1);
  }

  const translated: string[] = [];
  const skipped: string[] = [];
  const sortedLangs = Object.keys(languages).sort();
  type LangCode = keyof typeof languages;

  for (const lang of sortedLangs as LangCode[]) {
    const langName = languages[lang];
    const langFile = path.join(I18N_DIR, `${lang}.json`);

    if (await Bun.file(langFile).exists()) {
      console.log(`Skipping ${langName} — file already exists: ${langFile}`);
      skipped.push(langName);
      continue;
    }

    try {
      console.log(`Processing ${langName} → ${langFile}`);

      await $`telocity tf --params "gptoss" ${SOURCE_FILE} ${langFile} -i "Translate the following JSON from English to ${langName}, no commentary"`
        .quiet();

      const rawOutput = await Bun.file(langFile).text();
      const cleanedOutput = cleanTranslatedJson(rawOutput);
      await Bun.write(langFile, cleanedOutput);
      await $`telocity rm -f ${SOURCE_FILE}`.quiet();
      translated.push(langName);
    } catch (err) {
      console.error(`Failed to process ${langName}. Error:`, err);
      process.exit(1);
    }
  }

  console.log("\nTranslation script completed.");

  if (translated.length > 0) {
    console.log("\nTranslated:");
    console.log(translated.map((t) => `  - ${t}`).join("\n"));
  }

  if (skipped.length > 0) {
    console.log("\nSkipped:");
    console.log(skipped.map((s) => `  - ${s}`).join("\n"));
  }
}

translationTask().catch((err) => {
  console.error("An unexpected error occurred:", err);
  process.exit(1);
});
