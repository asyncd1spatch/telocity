import type {
  AnsiStyle,
  CommandConstructor,
  CustomOptionConfig,
  CustomParseArgsConfig,
  CustomParsedResults,
  FormatAlignedListOptions,
  GenericHelpSection,
  HelpSection,
} from "../types/index.ts";
import {
  AppStateSingleton,
  createError,
  errlog,
  stringWidth,
} from "./context.ts";

type InternalOptionConfig = CustomOptionConfig & { key: string };

function buildOptionMaps(
  options: Record<string, CustomOptionConfig> | undefined,
): {
  long: Map<string, InternalOptionConfig>;
  short: Map<string, InternalOptionConfig>;
} {
  const long = new Map<string, InternalOptionConfig>();
  const short = new Map<string, InternalOptionConfig>();

  if (!options) {
    return { long, short };
  }

  for (const [key, config] of Object.entries(options)) {
    const optionConfig: InternalOptionConfig = {
      key,
      ...config,
    };

    long.set(key, optionConfig);
    if (config.short) {
      short.set(config.short, optionConfig);
    }
  }
  return { long, short };
}

export function customParseArgs<
  T extends CustomParseArgsConfig<{
    options?: { [longOption: string]: CustomOptionConfig };
  }>,
>(config: T): CustomParsedResults<T> {
  const appState = AppStateSingleton.getInstance();
  const {
    args = [],
    options = {},
    allowPositionals = false,
    strict = false,
  } = config;

  const optionMaps = buildOptionMaps(options);

  const results: {
    values: { [key: string]: string | boolean };
    positionals: string[];
  } = {
    values: {},
    positionals: [],
  };

  let i = 0;
  let parsingOptions = true;

  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "--") {
      parsingOptions = false;
      i++;
      continue;
    }

    if (parsingOptions && arg.startsWith("-")) {
      if (arg.startsWith("--")) {
        const [optName, optValue] = arg.slice(2).split("=", 2);
        const optConfig = optionMaps.long.get(optName!);

        if (!optConfig) {
          if (strict) {
            throw createError(
              simpleTemplate(appState.s.e.lcli.unknownOption, { Option: arg }),
              { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" },
            );
          }
          i++;
          continue;
        }

        if (optConfig.type === "boolean") {
          if (optValue !== undefined) {
            throw createError(
              simpleTemplate(appState.s.e.lcli.booleanWithValue, {
                Option: optName!,
              }),
              { code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" },
            );
          }
          results.values[optConfig.key] = true;
        } else {
          if (optValue !== undefined) {
            results.values[optConfig.key] = optValue;
          } else if (i + 1 < args.length && !args[i + 1]?.startsWith("-")) {
            results.values[optConfig.key] = args[i + 1]!;
            i++;
          } else {
            throw createError(
              simpleTemplate(appState.s.e.lcli.missingValue, {
                Option: optName!,
              }),
              { code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" },
            );
          }
        }
      } else {
        const shortOpts = arg.slice(1);
        for (let j = 0; j < shortOpts.length; j++) {
          const optChar = shortOpts[j]!;
          const optConfig = optionMaps.short.get(optChar);

          if (!optConfig) {
            if (strict) {
              throw createError(
                simpleTemplate(appState.s.e.lcli.unknownOption, {
                  Option: `-${optChar}`,
                }),
                { code: "ERR_PARSE_ARGS_UNKNOWN_OPTION" },
              );
            }
            continue;
          }

          if (optConfig.type === "boolean") {
            results.values[optConfig.key] = true;
          } else {
            if (j < shortOpts.length - 1) {
              results.values[optConfig.key] = shortOpts.slice(j + 1);
              break;
            } else if (i + 1 < args.length && !args[i + 1]?.startsWith("-")) {
              results.values[optConfig.key] = args[i + 1]!;
              i++;
            } else {
              throw createError(
                simpleTemplate(appState.s.e.lcli.missingValue, {
                  Option: `-${optChar}`,
                }),
                { code: "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" },
              );
            }
          }
        }
      }
      i++;
    } else {
      if (allowPositionals || !parsingOptions) {
        results.positionals.push(arg);
      } else if (strict) {
        throw createError(
          simpleTemplate(appState.s.e.lcli.unexpectedPositional, {
            Argument: arg,
          }),
          { code: "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL" },
        );
      }
      i++;
    }
  }

  for (const config of optionMaps.long.values()) {
    const current = results.values[config.key];
    if (current !== undefined) continue;

    if (config.type === "boolean") {
      results.values[config.key] =
        config.default !== undefined ? config.default : false;
      continue;
    }

    if (config.default !== undefined) {
      results.values[config.key] = config.default;
    }
  }

  return results as CustomParsedResults<T>;
}

export function simpleTemplate(
  template: string,
  data: Record<string, string | number | boolean>,
): string {
  if (!template) return "";

  return template.replace(
    /\{\{\s*\.\s*(\w+)\s*\}\}/g,
    (match: string, key: string): string => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        return String(data[key]);
      }
      return match;
    },
  );
}

export interface WrapTextOptions {
  width: number;
}

export function wrapText(text: string, options: WrapTextOptions): string[] {
  if (!text) return [];

  const { width } = options;
  const paragraphs = text.split("\n");
  const result: string[] = [];
  const appState = AppStateSingleton.getInstance();
  const wordSegmenter = appState.wordSegmenter;
  const graphemeSegmenter = appState.segmenter;

  for (const p of paragraphs) {
    if (p.length === 0) {
      result.push("");
      continue;
    }

    let currentLineParts: string[] = [];
    let currentLineWidth = 0;

    for (const { segment } of wordSegmenter.segment(p)) {
      const segmentWidth = stringWidth(segment);
      const isWhitespace = /^\s+$/.test(segment);

      if (!isWhitespace && segmentWidth > width) {
        if (currentLineWidth > 0) {
          result.push(currentLineParts.join(""));
        }

        const longWordParts: string[] = [];
        let longWordPartWidth = 0;

        for (const { segment: grapheme } of graphemeSegmenter.segment(
          segment,
        )) {
          const graphemeWidth = stringWidth(grapheme);
          if (longWordPartWidth + graphemeWidth > width) {
            result.push(longWordParts.join(""));
            longWordParts.length = 0;
            longWordParts.push(grapheme);
            longWordPartWidth = graphemeWidth;
          } else {
            longWordParts.push(grapheme);
            longWordPartWidth += graphemeWidth;
          }
        }
        currentLineParts = [...longWordParts];
        currentLineWidth = longWordPartWidth;
        continue;
      }

      if (currentLineWidth > 0 && currentLineWidth + segmentWidth > width) {
        result.push(currentLineParts.join("").trimEnd());

        if (isWhitespace) {
          currentLineParts = [];
          currentLineWidth = 0;
        } else {
          currentLineParts = [segment];
          currentLineWidth = segmentWidth;
        }
      } else {
        currentLineParts.push(segment);
        currentLineWidth += segmentWidth;
      }
    }

    if (currentLineParts.length > 0) {
      result.push(currentLineParts.join(""));
    }
  }

  return result;
}

export class StreamedLineWrapper {
  private buffer = "";
  private currentLineWidth = 0;
  private outputBufferChunks: string[] = [];
  private queue: Promise<void> = Promise.resolve();
  private wordSegmenter: Intl.Segmenter;
  private graphemeSegmenter: Intl.Segmenter;
  private lastSegment = {
    text: "",
    width: 0,
    isWhitespace: false,
  };

  private readonly terminalWidth: number;
  private readonly onChunk: (s: string) => Promise<void> | void;
  private readonly maxBufferLength: number = 4096;
  private readonly widthCache = new Map<string, number>();
  private readonly widthCacheLimit: number = 2048;

  constructor(
    terminalWidth: number,
    onChunk: (s: string) => Promise<void> | void,
  ) {
    const appState = AppStateSingleton.getInstance();
    this.terminalWidth = terminalWidth ?? appState.TERMINAL_WIDTH;
    this.onChunk = onChunk;
    this.wordSegmenter = appState.wordSegmenter;
    this.graphemeSegmenter = appState.segmenter;
  }

  private stringWidthCached(s: string): number {
    const cachedWidth = this.widthCache.get(s);
    if (cachedWidth !== undefined) {
      this.widthCache.delete(s);
      this.widthCache.set(s, cachedWidth);
      return cachedWidth;
    }

    const width = stringWidth(s);
    this.widthCache.set(s, width);

    if (this.widthCache.size > this.widthCacheLimit) {
      const firstKey = this.widthCache.keys().next().value;
      if (firstKey !== undefined) this.widthCache.delete(firstKey);
    }
    return width;
  }

  private async flushOutput() {
    if (this.outputBufferChunks.length === 0) return;
    const out = this.outputBufferChunks.join("");
    this.outputBufferChunks = [];
    await this.onChunk(out);
  }

  private process(text: string) {
    if (!text) return;
    for (const { segment } of this.wordSegmenter.segment(text)) {
      if (segment.includes("\n")) {
        const parts = segment.split(/(\n)/g);
        for (const part of parts) {
          if (part === "\n") {
            this.outputBufferChunks.push("\n");
            this.currentLineWidth = 0;
            this.lastSegment = { text: "", width: 0, isWhitespace: false };
          } else if (part) {
            this.appendSegment(part);
          }
        }
      } else {
        this.appendSegment(segment);
      }
    }
  }

  private appendSegment(segment: string) {
    const segmentWidth = this.stringWidthCached(segment);
    const isWhitespace = /^\s+$/.test(segment);

    if (!isWhitespace && segmentWidth > this.terminalWidth) {
      if (this.currentLineWidth > 0) {
        if (this.lastSegment.isWhitespace) {
          this.outputBufferChunks.pop();
        }
        this.outputBufferChunks.push("\n");
        this.currentLineWidth = 0;
      }

      for (const { segment: grapheme } of this.graphemeSegmenter.segment(
        segment,
      )) {
        const graphemeWidth = this.stringWidthCached(grapheme);
        if (this.currentLineWidth + graphemeWidth > this.terminalWidth) {
          this.outputBufferChunks.push("\n");
          this.currentLineWidth = 0;
        }
        this.outputBufferChunks.push(grapheme);
        this.currentLineWidth += graphemeWidth;
      }

      this.lastSegment = {
        text: "...",
        width: this.currentLineWidth,
        isWhitespace: false,
      };
      return;
    }

    if (
      this.currentLineWidth > 0 &&
      this.currentLineWidth + segmentWidth > this.terminalWidth
    ) {
      if (this.lastSegment.isWhitespace) {
        this.outputBufferChunks.pop();
        this.currentLineWidth -= this.lastSegment.width;
      }

      this.outputBufferChunks.push("\n");
      this.currentLineWidth = 0;

      if (isWhitespace) {
        this.lastSegment = { text: "", width: 0, isWhitespace: false };
        return;
      }
    }

    this.outputBufferChunks.push(segment);
    this.currentLineWidth += segmentWidth;
    this.lastSegment = { text: segment, width: segmentWidth, isWhitespace };
  }

  public write(chunk: string): Promise<void> {
    this.queue = this.queue.then(async () => {
      this.buffer += chunk;

      const segments = Array.from(this.wordSegmenter.segment(this.buffer));

      let boundaryIndex = 0;

      if (segments.length > 1) {
        const lastSegment = segments[segments.length - 1];
        if (lastSegment) {
          boundaryIndex = lastSegment.index;
        }
      }

      if (this.buffer.length > this.maxBufferLength && boundaryIndex === 0) {
        boundaryIndex = this.buffer.length;
      }

      if (boundaryIndex === 0) {
        return;
      }

      const toProcess = this.buffer.substring(0, boundaryIndex);
      this.buffer = this.buffer.substring(boundaryIndex);

      this.process(toProcess);
      await this.flushOutput();
    });
    return this.queue;
  }

  private async internalFlush(force = false) {
    if (this.buffer) {
      this.process(this.buffer);
      this.buffer = "";
    }

    if (this.currentLineWidth > 0 && !force) {
      this.outputBufferChunks.push("\n");
      this.currentLineWidth = 0;
    }
    this.lastSegment = { text: "", width: 0, isWhitespace: false };
    await this.flushOutput();
  }

  public flush(): Promise<void> {
    this.queue = this.queue.then(() => this.internalFlush(false));
    return this.queue;
  }
}

export function formatAlignedList(
  items: Array<{ key: string; description: string }>,
  options: FormatAlignedListOptions = {},
): string {
  const appState = AppStateSingleton.getInstance();
  if (items.length === 0) return "";

  const {
    terminalWidth: termWidth = appState.TERMINAL_WIDTH,
    columnGap = appState.LIST_INDENT_WIDTH,
    firstColumnSeparator = "",
    forceFirstColumnWidth,
    listIndentWidth = 0,
  } = options;

  const indentString = " ".repeat(listIndentWidth);

  const firstColumnParts = items.map((item) => `${indentString}${item.key}`);

  const longestFirstColWidth =
    forceFirstColumnWidth ??
    Math.max(...firstColumnParts.map((part) => stringWidth(part)));

  const interstitial = firstColumnSeparator || " ".repeat(columnGap);

  const descriptionIndentWidth =
    longestFirstColWidth + stringWidth(interstitial);
  const descriptionIndent = " ".repeat(descriptionIndentWidth);
  const wrapWidth = termWidth - descriptionIndentWidth;

  if (wrapWidth <= 0) {
    errlog({ level: "warn" }, appState.s.e.lcli.listFormatWidthWarning);
    return items.map((item) => `${indentString}${item.key}`).join("\n");
  }

  const lines: string[] = [];
  items.forEach((item, index) => {
    const keyPart = firstColumnParts[index]!;
    const padding = " ".repeat(longestFirstColWidth - stringWidth(keyPart));
    const wrappedDesc = wrapText(item.description, { width: wrapWidth });

    lines.push(`${keyPart}${padding}${interstitial}${wrappedDesc[0] ?? ""}`);
    for (let i = 1; i < wrappedDesc.length; i++) {
      lines.push(`${descriptionIndent}${wrappedDesc[i]!}`);
    }
  });

  return lines.join("\n");
}

export function generateHelpText(
  helpSection: HelpSection | GenericHelpSection,
  optionsConfig?: CommandConstructor["options"],
  replacements: Record<string, string> = {},
): string {
  const appState = AppStateSingleton.getInstance();
  const lines: string[] = [];

  const tpl = (s?: string) => (s ? simpleTemplate(s, replacements) : "");

  if ("commandDescriptions" in helpSection && "commandHeader" in helpSection) {
    const genericSection = helpSection;

    const headerText = tpl(genericSection.header);
    const usageText = tpl(genericSection.usage);
    const footerText = tpl(genericSection.footer);
    const commandHeaderText = tpl(genericSection.commandHeader);
    const globalOptionsHeaderText = tpl(genericSection.globalOptionsHeader);

    const commandItems = Object.entries(genericSection.commandDescriptions).map(
      ([cmd, desc]) => ({
        key: cmd,
        description: tpl(desc ?? ""),
      }),
    );

    const flagItems = genericSection.flags
      ? Object.entries(genericSection.flags).map(([flag, desc]) => ({
          key: `--${flag}`,
          description: tpl(desc ?? ""),
        }))
      : [];

    const allKeys = [
      ...commandItems.map((i) => i.key),
      ...flagItems.map((i) => i.key),
    ];
    const longestRawKeyWidth = Math.max(...allKeys.map((k) => stringWidth(k)));
    const forcedWidth = longestRawKeyWidth + appState.LIST_INDENT_WIDTH;
    const listOptions = {
      forceFirstColumnWidth: forcedWidth,
      listIndentWidth: appState.LIST_INDENT_WIDTH,
    };

    lines.push(...wrapText(headerText, { width: appState.TERMINAL_WIDTH }));
    lines.push("", ...wrapText(usageText, { width: appState.TERMINAL_WIDTH }));
    lines.push(`\n${commandHeaderText}`);
    lines.push(formatAlignedList(commandItems, listOptions));

    if (footerText) {
      lines.push(
        "",
        ...wrapText(footerText, { width: appState.TERMINAL_WIDTH }),
      );
    }

    if (flagItems.length > 0) {
      lines.push(`\n${globalOptionsHeaderText}`);
      lines.push(formatAlignedList(flagItems, listOptions));
    }
  } else {
    const specificSection = helpSection;

    const usageText = tpl(specificSection.usage);
    const descriptionText = tpl(specificSection.description);
    const footerText = tpl(specificSection.footer);

    lines.push(...wrapText(usageText, { width: appState.TERMINAL_WIDTH }));
    lines.push(
      "",
      ...wrapText(descriptionText, { width: appState.TERMINAL_WIDTH }),
    );

    if (specificSection.flags && optionsConfig) {
      lines.push("\nOptions:");

      const itemsToFormat = Object.entries(optionsConfig).map(
        ([longName, config]) => {
          const parts: string[] = [];
          if (config.short) parts.push(`-${config.short},`);
          parts.push(`--${longName}`);
          if (config.type === "string") parts.push("<value>");

          return {
            key: parts.join(" "),
            description: tpl(specificSection.flags?.[longName] ?? ""),
          };
        },
      );

      lines.push(
        formatAlignedList(itemsToFormat, {
          listIndentWidth: appState.LIST_INDENT_WIDTH,
        }),
      );
    }

    if (footerText) {
      lines.push(
        "",
        ...wrapText(footerText, { width: appState.TERMINAL_WIDTH }),
      );
    }
  }

  return lines.join("\n");
}

export function generateLocaleList(
  localeData: Record<string, { name: string }>,
): string {
  const appState = AppStateSingleton.getInstance();
  const items = Object.entries(localeData).map(([code, { name }]) => ({
    key: code,
    description: name,
  }));

  return formatAlignedList(items, {
    listIndentWidth: appState.LIST_INDENT_WIDTH,
    firstColumnSeparator: appState.SEPARATOR,
  });
}

export function log(...msg: unknown[]): void {
  console.log(...msg);
}

export const ANSI_CODES = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  yellowBright: "\x1b[93m",
  blue: "\x1b[34m",

  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
  strikethrough: "\x1b[9m",

  reset: "\x1b[0m",
  resetBoldDim: "\x1b[22m",
  resetItalic: "\x1b[23m",
  resetUnderline: "\x1b[24m",
  resetStrikethrough: "\x1b[29m",
} as const;

export const style =
  (start: string, end: string): AnsiStyle =>
  (text: string) =>
    `${start}${text}${end}`;

export const colorize = (color: keyof typeof ANSI_CODES): AnsiStyle =>
  style(ANSI_CODES[color], ANSI_CODES.reset);

export const noop: AnsiStyle = (text) => text;

const isTty = process.stdout.isTTY;

export const red = isTty ? colorize("red") : noop;
export const yellow = isTty ? colorize("yellow") : noop;
export const yellowBright = isTty ? colorize("yellowBright") : noop;
export const blue = isTty ? colorize("blue") : noop;

export const bold = isTty
  ? style(ANSI_CODES.bold, ANSI_CODES.resetBoldDim)
  : noop;
export const dim = isTty
  ? style(ANSI_CODES.dim, ANSI_CODES.resetBoldDim)
  : noop;
export const italic = isTty
  ? style(ANSI_CODES.italic, ANSI_CODES.resetItalic)
  : noop;
export const underline = isTty
  ? style(ANSI_CODES.underline, ANSI_CODES.resetUnderline)
  : noop;
export const strikethrough = isTty
  ? style(ANSI_CODES.strikethrough, ANSI_CODES.resetStrikethrough)
  : noop;

export const compose =
  (...fns: AnsiStyle[]): AnsiStyle =>
  (x: string) =>
    fns.reduceRight((v, f) => f(v), x);

export async function readStdin(): Promise<string> {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
