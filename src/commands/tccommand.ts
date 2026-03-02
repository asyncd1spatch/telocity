import { createWriteStream, constants as fsConstants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  errlog,
  exitOne,
  generateHelpText,
  isNodeError,
  log,
  customParseArgs as parseArgs,
  readStdin,
  red,
  runConcur,
  simpleTemplate,
  yellow,
} from "../libs/core/index.ts";
import { stripGarbageNewLines, validateFiles } from "../libs/LLM/index.ts";
import {
  countTokens,
  countTokensInParallel,
  shutdownTokenCounter,
} from "../libs/thirdparty/index.ts";
import type { Command } from "../libs/types/index.ts";

interface TypeMap {
  string: string;
  boolean: boolean;
  number: number;
}

type TcCommandArgs = {
  [K in keyof typeof TcCommand.options]: TypeMap[(typeof TcCommand.options)[K]["type"]];
};

export default class TcCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get helpReplacements() {
    return { DefaultModel: appConfig.DEFAULT_MODEL };
  }
  static get options() {
    return {
      params: { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
      help: { type: "boolean", short: "h" },
      downloadmodel: { type: "string", short: "d" },
    } as const;
  }

  static get MODELS_TO_DOWNLOAD(): Readonly<{
    readonly [key: string]: readonly string[];
  }> {
    return {
      qwen: [
        "https://huggingface.co/Qwen/Qwen3.5-35B-A3B/resolve/main/tokenizer.json",
        "https://huggingface.co/Qwen/Qwen3.5-35B-A3B/resolve/main/tokenizer_config.json",
      ],
      hymt: [
        "https://huggingface.co/tencent/HY-MT1.5-7B/resolve/main/tokenizer.json",
        "https://huggingface.co/tencent/HY-MT1.5-7B/resolve/main/tokenizer_config.json",
      ],
      mistral: [
        "https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512/resolve/main/tokenizer.json",
        "https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512/resolve/main/tokenizer_config.json",
      ],
    } as const;
  }

  private static get availableModels() {
    return Object.keys(TcCommand.MODELS_TO_DOWNLOAD).join(", ");
  }

  private async handleModelDownload(modelName: string): Promise<number | void> {
    const appState = AppStateSingleton.getInstance();
    const modelUrls =
      TcCommand.MODELS_TO_DOWNLOAD[
        modelName as keyof typeof TcCommand.MODELS_TO_DOWNLOAD
      ];

    if (!modelUrls) {
      errlog(
        red(
          simpleTemplate(appState.s.e.c.tc.modelNotFoundForDownload, {
            ModelName: modelName,
          }),
        ),
      );
      log(
        simpleTemplate(appState.s.m.c.tc.availableModelsForDownload, {
          AvailableModels: TcCommand.availableModels,
        }),
      );
      exitOne();
      return 1;
    }

    log(
      simpleTemplate(appState.s.m.c.tc.downloadingModelFiles, {
        ModelName: modelName,
      }),
    );

    const baseDir = path.join(appState.STATE_DIR, "models");
    const [modelUrl, configUrl] = modelUrls;
    const modelDestPath = path.join(baseDir, `${modelName}.json`);
    const configDestPath = path.join(baseDir, `${modelName}_config.json`);

    try {
      await access(modelDestPath, fsConstants.F_OK);
      await access(configDestPath, fsConstants.F_OK);
      log(appState.s.e.c.tc.skippingDownload);
      log(`- ${modelDestPath}`);
      log(`- ${configDestPath}`);
      exitOne();
      return 1;
    } catch {
      try {
        await mkdir(baseDir, { recursive: true });

        log(
          simpleTemplate(appState.s.m.c.tc.writingFilesTo, {
            StateDir: baseDir,
          }),
        );

        const HARD_TIMEOUT = 5 * 60 * 1000;

        const downloadAndSave = async (url: string, destPath: string) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), HARD_TIMEOUT);

          try {
            const res = await fetch(url, { signal: controller.signal });

            if (!res.ok) {
              throw createError(
                simpleTemplate(appState.s.e.c.tc.failedToDownload, {
                  ModelUrl: url,
                  Status: res.status,
                  StatusText: res.statusText,
                }),
              );
            }
            if (!res.body) {
              throw createError(appState.s.e.lllm.responseNull, {
                code: "NULL_RESPONSE_BODY",
              });
            }

            await pipeline(
              res.body as unknown as AsyncIterable<Uint8Array>,
              createWriteStream(destPath),
            );
          } finally {
            clearTimeout(timeoutId);
          }
        };

        await runConcur(
          [
            () => downloadAndSave(modelUrl!, modelDestPath),
            () => downloadAndSave(configUrl!, configDestPath),
          ],
          { concurrency: 2 },
        );

        log(
          simpleTemplate(appState.s.m.c.tc.downloadSuccess, {
            ModelName: modelName,
          }),
        );
        log(`- ${modelDestPath}`);
        log(`- ${configDestPath}`);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          errlog(red(appState.s.e.lllm.hardTimeOut));
        } else if (isNodeError(err)) {
          errlog(
            red(
              simpleTemplate(appState.s.e.c.tc.modelDownloadError, {
                ErrorMessage: err.message,
              }),
            ),
          );
        }
        exitOne();
      }
    }
  }

  private chunkText(text: string, chunkSize: number): string[] {
    const chunks: string[] = [];
    const lines = text.split("\n");
    let currentChunk = "";
    let currentSize = 0;

    for (const line of lines) {
      const lineWithNewline = `${line}\n`;
      const lineSize = Buffer.byteLength(lineWithNewline);

      if (currentSize + lineSize > chunkSize && currentChunk !== "") {
        chunks.push(currentChunk);
        currentChunk = lineWithNewline;
        currentSize = lineSize;
      } else {
        currentChunk += lineWithNewline;
        currentSize += lineSize;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    return chunks;
  }

  private async countTok(normalizedText: string, model: string) {
    const appState = AppStateSingleton.getInstance();
    const specialTokensCount = await countTokens(model, "", {
      add_special_tokens: true,
    });

    const chunkSize = 750000;
    const chunks = this.chunkText(normalizedText, chunkSize);
    const inputs = chunks.map((chunk) => ({
      text: chunk,
      options: { add_special_tokens: false },
    }));

    const counts = await countTokensInParallel(model, inputs);
    const textOnlyTokenCount = counts.reduce((sum, count) => sum + count, 0);

    const tokenCount = textOnlyTokenCount + specialTokensCount;
    const lineCount = normalizedText.split("\n").length;
    const avgPerLine = (tokenCount / lineCount).toFixed(2);

    log(`${model}:`);
    log(`${appState.s.m.c.tc.tc}`, yellow(tokenCount.toString()));
    log(`${appState.s.m.c.tc.avgTc}`, yellow(avgPerLine));
  }

  async execute(argv: string[]): Promise<number> {
    try {
      const appState = AppStateSingleton.getInstance();
      const { values: argValues, positionals } = parseArgs({
        args: argv,
        allowPositionals: (this.constructor as typeof TcCommand)
          .allowPositionals,
        strict: true,
        options: (this.constructor as typeof TcCommand).options,
      }) as { values: TcCommandArgs; positionals: string[] };

      const tcHelp = () => {
        const helpText = generateHelpText(
          appState.s.help.commands.tc,
          (this.constructor as typeof TcCommand).options,
          {
            TokenParamList: TcCommand.availableModels,
            DefaultModel: appConfig.DEFAULT_MODEL,
          },
        );
        log(helpText);
      };

      if (argValues.help) {
        tcHelp();
        return 0;
      }

      if (argValues["downloadmodel"]) {
        await this.handleModelDownload(argValues["downloadmodel"]);
        return 0;
      }

      let normalizedText: string;

      if (appState.isInteractive && !process.stdin.isTTY) {
        const text = await readStdin();
        normalizedText = stripGarbageNewLines(text);
      } else {
        if (!positionals[1]) {
          exitOne();
          tcHelp();
          throw createError(appState.s.e.lllm.sourceRequired, {
            code: "SOURCE_REQUIRED",
          });
        }

        const sourcePath = positionals[1];
        await validateFiles(sourcePath);

        const rawText = await readFile(sourcePath, "utf-8");
        normalizedText = stripGarbageNewLines(rawText);
      }

      const presetName = argValues.params;

      if (!(presetName in TcCommand.MODELS_TO_DOWNLOAD)) {
        exitOne();
        tcHelp();
        errlog(
          red(
            simpleTemplate(appState.s.e.c.tc.tokenizerDoesNotExist, {
              PresetName: presetName,
            }),
          ),
        );
        return 1;
      }

      await this.countTok(normalizedText, presetName);

      return 0;
    } finally {
      shutdownTokenCounter();
    }
  }
}
