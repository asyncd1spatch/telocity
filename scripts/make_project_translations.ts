#!/usr/bin/env bun

import { exec as execCallback } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execCallback);

const languages = {
  "fr-FR": "French (France) [fr-FR]",
  "ja-JP": "Japanese (Japan) [ja-JP]",
  "zh-CN": "Simplified Chinese (China) [zh-CN]",
} as const;

const PROJECT_ROOT = process.cwd();
const I18N_DIR = path.join(PROJECT_ROOT, "data", "i18n");
const SOURCE_FILE = path.join(I18N_DIR, "en-US.json");

function isEnoentError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err && err.code === "ENOENT";
}

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
  } catch (err) {
    if (isEnoentError(err)) {
      console.error(`Error: i18n directory not found at ${I18N_DIR}`);
      process.exit(1);
    }
    throw err;
  }

  try {
    await stat(SOURCE_FILE);
  } catch (err) {
    if (isEnoentError(err)) {
      console.error(`Error: Source file not found at ${SOURCE_FILE}`);
      process.exit(1);
    }
    throw err;
  }

  const translated: string[] = [];
  const skipped: string[] = [];
  const sortedLangs = Object.keys(languages).sort();
  type LangCode = keyof typeof languages;

  for (const lang of sortedLangs as LangCode[]) {
    const langName = languages[lang];
    const langFile = path.join(I18N_DIR, `${lang}.json`);

    try {
      await stat(langFile);
      console.log(`Skipping ${langName} — file already exists: ${langFile}`);
      skipped.push(langName);
      continue;
    } catch (err) {
      if (!isEnoentError(err)) {
        console.error(`Error checking status of ${langFile}:`, err);
        process.exit(1);
      }
    }

    try {
      console.log(`Processing ${langName} → ${langFile}`);

      await exec(
        `telocity tr "${SOURCE_FILE}" "${langFile}" --source "English (US) [en-US]" --target "${langName}" --chunksize "200000" --batchsize 1 --parallel 1 --params "qwen" --model "qwenq8"`,
      );

      const rawOutput = await readFile(langFile, "utf-8");
      const cleanedOutput = cleanTranslatedJson(rawOutput);
      await writeFile(langFile, cleanedOutput, "utf-8");

      // Clean up progress state file
      await exec(`telocity rm -f "${SOURCE_FILE}"`);
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
