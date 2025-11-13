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
  runConcur,
  simpleTemplate,
  yellow,
} from "../libs/core";
import { stripGarbageNewLines, validateFiles } from "../libs/LLM";
import { countTokens, countTokensInParallel, shutdownTokenCounter } from "../libs/thirdparty";
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
      downloadmodel: { type: "string", short: "d" },
    } as const;
  }

  static get MODELS_TO_DOWNLOAD(): Readonly<{
    readonly [key: string]: readonly string[];
  }> {
    return {
      "qwen": [
        "https://huggingface.co/unsloth/Qwen3-VL-4B-Instruct/resolve/main/tokenizer.json",
        "https://huggingface.co/unsloth/Qwen3-VL-4B-Instruct/resolve/main/tokenizer_config.json",
      ],
      "gptoss": [
        "https://huggingface.co/openai/gpt-oss-20b/resolve/main/tokenizer.json",
        "https://huggingface.co/openai/gpt-oss-20b/resolve/main/tokenizer_config.json",
      ],
    } as const;
  }

  private static get availableModels() {
    return Object.keys(
      TcCommand.MODELS_TO_DOWNLOAD,
    ).join(", ");
  }

  private async handleModelDownload(modelName: string): Promise<number | void> {
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
      const tasks = [
        () => fetch(modelUrl!),
        () => fetch(configUrl!),
      ] as const;

      const [modelResponse, configResponse] = await runConcur(tasks);

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

      const [modelData, configData] = await runConcur(
        [
          () => modelResponse.arrayBuffer(),
          () => configResponse.arrayBuffer(),
        ] as const,
      );

      await runConcur([
        () => Bun.write(modelDestPath, modelData),
        () => Bun.write(configDestPath, configData),
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

    log(`${model}:`, yellow(tokenCount.toString()));
  }

  async execute(argv: string[]): Promise<number> {
    try {
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
        await this.handleModelDownload(argValues["downloadmodel"]);
        return 0;
      }

      let normalizedText: string;

      if (!process.stdin.isTTY) {
        const text = await Bun.stdin.text();
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

      await this.countTok(normalizedText, presetName);

      return 0;
    } finally {
      shutdownTokenCounter();
    }
  }
}
