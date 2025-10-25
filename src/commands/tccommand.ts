import { cpus } from "node:os";
import path from "node:path";
import {
  AppStateSingleton,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  generateHelpText,
  isNodeError,
  log,
  red,
  simpleTemplate,
  yellow,
} from "../libs/core";
import { stripGarbageNewLines, validateFiles } from "../libs/LLM";
import { countTokens, countTokensInParallel } from "../libs/thirdparty";
import type { Command } from "../libs/types";

interface TypeMap {
  string: string;
  boolean: boolean;
  number: number;
}

type TcCommandArgs = {
  [K in keyof typeof TcCommand.options]: TypeMap[
    typeof TcCommand.options[K]["type"]
  ];
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
      benchmark: { type: "boolean", short: "b", default: false },
      chunksizes: {
        type: "string",
        short: "c",
        default: "500000,1000000,2000000",
      },
      workercounts: {
        type: "string",
        short: "w",
      },
      downloadmodel: { type: "string", short: "d" },
    } as const;
  }

  static get MODELS_TO_DOWNLOAD(): Readonly<{
    readonly [key: string]: readonly string[];
  }> {
    return {
      "gptoss": [
        "https://huggingface.co/openai/gpt-oss-20b/resolve/main/tokenizer.json",
        "https://huggingface.co/openai/gpt-oss-20b/resolve/main/tokenizer_config.json",
      ],
      "gemma": [
        "https://huggingface.co/unsloth/gemma-3-4b-it/resolve/main/tokenizer.json",
        "https://huggingface.co/unsloth/gemma-3-4b-it/resolve/main/tokenizer_config.json",
      ],
      "granite": [
        "https://huggingface.co/ibm-granite/granite-4.0-h-tiny/resolve/main/tokenizer.json",
        "https://huggingface.co/ibm-granite/granite-4.0-h-tiny/resolve/main/tokenizer_config.json",
      ],
    } as const;
  }

  private static get availableModels() {
    return Object.keys(
      TcCommand.MODELS_TO_DOWNLOAD,
    ).join(", ");
  }

  private async _handleModelDownload(modelName: string): Promise<number | void> {
    const appState = AppStateSingleton.getInstance();
    const modelUrls = TcCommand.MODELS_TO_DOWNLOAD[
      modelName as keyof typeof TcCommand.MODELS_TO_DOWNLOAD
    ];

    if (!modelUrls) {
      errlog(red(simpleTemplate(appState.s.e.c.tc.modelNotFoundForDownload, { ModelName: modelName })));
      log(
        simpleTemplate(appState.s.m.c.tc.availableModelsForDownload, {
          AvailableModels: TcCommand.availableModels,
        }),
      );
      exitOne();
      return 1;
    }

    log(simpleTemplate(appState.s.m.c.tc.downloadingModelFiles, { ModelName: modelName }));

    const baseDir = path.join(appState.STATE_DIR, "models");
    const [modelUrl, configUrl] = modelUrls;
    const modelDestPath = path.join(baseDir, `${modelName}.json`);
    const configDestPath = path.join(
      baseDir,
      `${modelName}_config.json`,
    );

    try {
      const [modelResponse, configResponse] = await Promise.all([
        fetch(modelUrl!),
        fetch(configUrl!),
      ]);

      if (!modelResponse.ok) {
        throw createError(
          simpleTemplate(appState.s.e.c.tc.failedToDownload, {
            ModelUrl: modelUrl!,
            Status: modelResponse.status,
            StatusText: modelResponse.statusText,
          }),
        );
      }
      if (!configResponse.ok) {
        throw createError(
          simpleTemplate(appState.s.e.c.tc.failedToDownload, {
            ModelUrl: configUrl!,
            Status: configResponse.status,
            StatusText: configResponse.statusText,
          }),
        );
      }

      log(simpleTemplate(appState.s.m.c.tc.writingFilesTo, { StateDir: baseDir }));

      const modelData = await modelResponse.arrayBuffer();
      const configData = await configResponse.arrayBuffer();

      await Promise.all([
        Bun.write(modelDestPath, modelData),
        Bun.write(configDestPath, configData),
      ]);

      log(simpleTemplate(appState.s.m.c.tc.downloadSuccess, { ModelName: modelName }));
      log(`- ${modelDestPath}`);
      log(`- ${configDestPath}`);
    } catch (err) {
      if (isNodeError(err)) {
        errlog(red(simpleTemplate(appState.s.e.c.tc.modelDownloadError, { ErrorMessage: err.message })));
      }
      exitOne();
    }
  }

  private _chunkText(text: string, chunkSize: number): string[] {
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

  private async _runNormalCount(normalizedText: string, model: string) {
    const specialTokensCount = await countTokens(model, "", {
      add_special_tokens: true,
    });

    const chunkSize = 750000;
    const chunks = this._chunkText(normalizedText, chunkSize);
    const inputs = chunks.map((chunk) => ({
      text: chunk,
      options: { add_special_tokens: false },
    }));

    const counts = await countTokensInParallel(model, inputs);
    const textOnlyTokenCount = counts.reduce((sum, count) => sum + count, 0);

    const tokenCount = textOnlyTokenCount + specialTokensCount;

    log(`${model}:`, yellow(tokenCount.toString()));
  }

  private async _runBenchmark(
    normalizedText: string,
    textSize: number,
    model: string,
    argValues: TcCommandArgs,
  ) {
    const appState = AppStateSingleton.getInstance();
    log(
      simpleTemplate(appState.s.m.c.tc.benchmarkStart, {
        ModelName: model,
        MB: (textSize / 1024 / 1024).toFixed(2),
      }),
    );

    const chunkSizes = argValues.chunksizes
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0);
    const workerCounts = (argValues.workercounts ?? `2,4,${cpus().length}`)
      .split(",")
      .map(Number)
      .filter((n) => !isNaN(n) && n > 0);

    if (chunkSizes.length === 0 || workerCounts.length === 0) {
      errlog(red(appState.s.e.c.tc.invalidBenchmarkFlags));
      return;
    }

    const specialTokensCount = await countTokens(model, "", {
      add_special_tokens: true,
    });

    for (const chunkSize of chunkSizes) {
      log(
        simpleTemplate(appState.s.m.c.tc.benchmarkChunkSize, {
          ChunkSize: (chunkSize / 1024 / 1024).toFixed(2),
        }),
      );

      const chunks = this._chunkText(normalizedText, chunkSize);
      const inputs = chunks.map((chunk) => ({
        text: chunk,
        options: { add_special_tokens: false },
      }));
      log(
        simpleTemplate(appState.s.m.c.tc.benchmarkSplitIntoChunks, {
          Chunks: chunks.length,
        }),
      );

      for (const numWorkers of workerCounts) {
        const startTime = performance.now();
        const counts = await countTokensInParallel(model, inputs, {
          numWorkers,
        });
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        const textOnlyTokenCount = counts.reduce(
          (sum, count) => sum + count,
          0,
        );
        const totalTokenCount = textOnlyTokenCount + specialTokensCount;

        const wcRep = yellow(numWorkers.toString().padStart(2));
        const timeRep = red(duration.padStart(8, " "));
        log(
          simpleTemplate(appState.s.m.c.tc.benchmarkResultLine, {
            WcRep: wcRep,
            Time: timeRep,
            TC: totalTokenCount,
          }),
        );
      }
    }
    log(appState.s.m.c.tc.benchmarkComplete);
  }

  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof TcCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof TcCommand).options,
    }) as { values: TcCommandArgs; positionals: string[] };

    const tcHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.tc,
        (this.constructor as typeof TcCommand).options,
        { TokenParamList: TcCommand.availableModels, DefaultModel: appConfig.DEFAULT_MODEL },
      );
      log(helpText);
    };

    if (argValues.help) {
      tcHelp();
      return 0;
    }

    if (argValues["downloadmodel"]) {
      await this._handleModelDownload(argValues["downloadmodel"]);
      return 0;
    }

    let textSize: number;
    let normalizedText: string;

    if (!process.stdin.isTTY) {
      const text = await Bun.stdin.text();
      textSize = Buffer.byteLength(text);
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

      const sourceFile = Bun.file(sourcePath);
      textSize = sourceFile.size;
      const rawText = await sourceFile.text();
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

    if (argValues.benchmark) {
      await this._runBenchmark(normalizedText, textSize, presetName, argValues);
    } else {
      await this._runNormalCount(normalizedText, presetName);
    }

    return 0;
  }
}
