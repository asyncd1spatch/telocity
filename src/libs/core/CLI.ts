import type {
  CommandConstructor,
  CustomOptionConfig,
  CustomParseArgsConfig,
  CustomParsedResults,
  FormatAlignedListOptions,
  GenericHelpSection,
  HelpSection,
} from "../types";
import { AppStateSingleton, createError, errlog } from "./context";

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

  for (const [key, config] of Object.entries(options) as [string, CustomOptionConfig][]) {
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
  T extends CustomParseArgsConfig<{ options?: { [longOption: string]: CustomOptionConfig } }>,
>(config: T): CustomParsedResults<T> {
  const appState = AppStateSingleton.getInstance();
  const { args = [], options = {}, allowPositionals = false, strict = false } = config;

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
              simpleTemplate(appState.s.e.lcli.booleanWithValue, { Option: optName! }),
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
              simpleTemplate(appState.s.e.lcli.missingValue, { Option: optName! }),
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
                simpleTemplate(appState.s.e.lcli.unknownOption, { Option: `-${optChar}` }),
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
                simpleTemplate(appState.s.e.lcli.missingValue, { Option: `-${optChar}` }),
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
          simpleTemplate(appState.s.e.lcli.unexpectedPositional, { Argument: arg }),
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
      results.values[config.key] = config.default !== undefined ? config.default : false;
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
    /\{\{\s*\.(.*?)\s*\}\}/g,
    (match: string, key: string): string => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        return String(data[key]);
      }
      return match;
    },
  );
}

export function wrapText(text: string, options: { width: number }): string[] {
  if (!text) {
    return [];
  }

  const { width } = options;
  const paragraphs = text.split("\n");
  const allWrappedLines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      allWrappedLines.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      if (Bun.stringWidth(word) > width) {
        if (currentLine.length > 0) {
          allWrappedLines.push(currentLine);
          currentLine = "";
        }
        allWrappedLines.push(word);
        continue;
      }

      const prospectiveLine = currentLine.length === 0 ? word : `${currentLine} ${word}`;
      if (Bun.stringWidth(prospectiveLine) <= width) {
        currentLine = prospectiveLine;
      } else {
        allWrappedLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine.length > 0) {
      allWrappedLines.push(currentLine);
    }
  }

  return allWrappedLines;
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

  const longestFirstColWidth = forceFirstColumnWidth
    ?? Math.max(...firstColumnParts.map((part) => Bun.stringWidth(part)));

  const interstitial = firstColumnSeparator || " ".repeat(columnGap);

  const descriptionIndentWidth = longestFirstColWidth + Bun.stringWidth(interstitial);
  const descriptionIndent = " ".repeat(descriptionIndentWidth);
  const wrapWidth = termWidth - descriptionIndentWidth;

  if (wrapWidth <= 0) {
    errlog({ level: "warn" }, "Warning: Not enough space to format list description.");
    return items.map(item => `${indentString}${item.key}`).join("\n");
  }

  const lines: string[] = [];
  items.forEach((item, index) => {
    const keyPart = firstColumnParts[index]!;
    const padding = " ".repeat(longestFirstColWidth - Bun.stringWidth(keyPart));
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

  if ("commandDescriptions" in helpSection && "commandHeader" in helpSection) {
    const genericSection = helpSection as GenericHelpSection;

    const commandItems = Object.entries(genericSection.commandDescriptions).map(
      ([cmd, desc]) => ({
        key: cmd,
        description: desc ?? "",
      }),
    );

    const flagItems = genericSection.flags
      ? Object.entries(genericSection.flags).map(([flag, desc]) => ({
        key: `--${flag}`,
        description: desc ?? "",
      }))
      : [];

    const allKeys = [...commandItems.map((i) => i.key), ...flagItems.map((i) => i.key)];
    const longestRawKeyWidth = Math.max(...allKeys.map((k) => Bun.stringWidth(k)));
    const forcedWidth = longestRawKeyWidth + appState.LIST_INDENT_WIDTH;
    const listOptions = {
      forceFirstColumnWidth: forcedWidth,
      listIndentWidth: appState.LIST_INDENT_WIDTH,
    };

    lines.push(...wrapText(genericSection.header, { width: appState.TERMINAL_WIDTH }));
    lines.push("", ...wrapText(genericSection.usage, { width: appState.TERMINAL_WIDTH }));
    lines.push(`\n${genericSection.commandHeader}`);
    lines.push(formatAlignedList(commandItems, listOptions));

    if (genericSection.footer) {
      lines.push("", ...wrapText(genericSection.footer, { width: appState.TERMINAL_WIDTH }));
    }

    if (flagItems.length > 0) {
      lines.push(`\n${genericSection.globalOptionsHeader}`);
      lines.push(formatAlignedList(flagItems, listOptions));
    }
  } else {
    const specificSection = helpSection as HelpSection;

    lines.push(...wrapText(specificSection.usage, { width: appState.TERMINAL_WIDTH }));
    lines.push("", ...wrapText(specificSection.description, { width: appState.TERMINAL_WIDTH }));

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
            description: specificSection.flags?.[longName] ?? "",
          };
        },
      );

      lines.push(
        formatAlignedList(itemsToFormat, { listIndentWidth: appState.LIST_INDENT_WIDTH }),
      );
    }

    if (specificSection.footer) {
      lines.push("", ...wrapText(specificSection.footer, { width: appState.TERMINAL_WIDTH }));
    }
  }

  const rawText = lines.join("\n");
  return simpleTemplate(rawText, replacements);
}

export function generateLocaleList(
  localeData: Record<string, { name: string }>,
): string {
  const appState = AppStateSingleton.getInstance();
  const items = Object.entries(localeData).map(
    ([code, { name }]) => ({
      key: code,
      description: name,
    }),
  );

  return formatAlignedList(items, {
    listIndentWidth: appState.LIST_INDENT_WIDTH,
    firstColumnSeparator: appState.SEPARATOR,
  });
}

export function log(...msg: unknown[]): void {
  console.log(...msg);
}

const isInteractive = process.stdout.isTTY;
const noop = (text: string): string => text;
export const red = isInteractive
  ? (text: string) => `\x1b[31m${text}\x1b[0m`
  : noop;
export const yellow = isInteractive
  ? (text: string) => `\x1b[33m${text}\x1b[0m`
  : noop;
export const yellowBright = isInteractive
  ? (text: string) => `\x1b[93m${text}\x1b[0m`
  : noop;
export const blue = isInteractive
  ? (text: string) => `\x1b[34m${text}\x1b[0m`
  : noop;
