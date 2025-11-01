import {
  AppStateSingleton,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  errlog,
  exitOne,
  generateHelpText,
  log,
  red,
  simpleTemplate,
} from "../libs/core";
import { getThinkTags, stripGarbageNewLines, validateFiles } from "../libs/LLM";
import type { Command } from "../libs/types";

export default class StripCommand implements Command {
  static get allowPositionals() {
    return true;
  }
  static get positionalCompletion() {
    return "file" as const;
  }
  static get options() {
    return {
      startdelimiter: { type: "string", short: "s" },
      enddelimiter: { type: "string", short: "e" },
      params: { type: "string", short: "p" },
      extracttag: { type: "boolean", short: "x" },
      compress: { type: "boolean", short: "c", default: false },
      help: { type: "boolean", short: "h" },
    } as const;
  }
  async execute(argv: string[]): Promise<number> {
    const appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      allowPositionals: (this.constructor as typeof StripCommand).allowPositionals,
      strict: true,
      options: (this.constructor as typeof StripCommand).options,
    });
    let { startdelimiter, enddelimiter } = argValues;

    const stripHelp = () => {
      const helpText = generateHelpText(
        appState.s.help.commands.st,
        (this.constructor as typeof StripCommand).options,
        { ReasoningTagParamList: getThinkTags(appConfig.PARAM_CONFIGS) },
      );
      log(helpText);
    };
    if (argValues.help) {
      stripHelp();
      return 0;
    }

    if (argValues.params) {
      const paramsKey = argValues.params;
      const modelConfig = appConfig.PARAM_CONFIGS[paramsKey];

      if (!modelConfig) {
        throw createError(simpleTemplate(appState.s.e.lllm.undefinedParam, { ParamKey: paramsKey }), {
          code: "UNDEFINED_PARAM",
        });
      }

      startdelimiter ??= modelConfig.metadata?.stripTags?.start;
      enddelimiter ??= modelConfig.metadata?.stripTags?.end;
    }

    if (!positionals[1] || !positionals[2]) {
      exitOne();
      stripHelp();
      errlog(red(appState.s.e.lllm.sourceTargetRequired));
      return 1;
    }
    const sourcePath = positionals[1];
    const targetPath = positionals[2];

    await validateFiles(sourcePath, targetPath);
    if (
      (startdelimiter && !enddelimiter)
      || (!startdelimiter && enddelimiter)
    ) {
      exitOne();
      stripHelp();
      errlog(red(appState.s.e.c.st.delimiterPairRequired));
      return 1;
    }

    let text = await Bun.file(sourcePath).text();
    const finalMessage = [];
    if (startdelimiter && enddelimiter) {
      const action = argValues.extracttag ? "extract" : "delete";
      const extractorRegex = new RegExp(
        `${RegExp.escape(startdelimiter)}(.*?)${RegExp.escape(enddelimiter)}`,
        "gs",
      );

      switch (action) {
        case "extract": {
          const matches = text.matchAll(extractorRegex);
          const extractedContents = [];
          for (const match of matches) {
            if (match[1]) {
              extractedContents.push(match[1].trim());
            }
          }
          text = extractedContents.join("\n\n");
          finalMessage.push(appState.s.m.c.st.blockExtracted);
          break;
        }
        case "delete":
          text = text.replace(extractorRegex, "");
          finalMessage.push(appState.s.m.c.st.blockDeleted);
          break;
      }
    }

    text = stripGarbageNewLines(text, argValues.compress);

    const targetFile = Bun.file(targetPath);

    if (await targetFile.exists()) {
      errlog(red(simpleTemplate(appState.s.e.lllm.targetFileExists, { TargetPath: targetPath })));
      return 1;
    }

    await Bun.write(targetFile, text);

    if (argValues.compress) {
      finalMessage.push(appState.s.m.c.st.compressed);
    }
    finalMessage.push(appState.s.m.c.st.newlinesNormalized);
    log(finalMessage.join("\n"));
    return 0;
  }
}
