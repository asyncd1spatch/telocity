import { stdin, stdout } from "node:process";
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
    errlog({ level: "warn" }, appState.s.e.lcli.listFormatWidthWarning);
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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

class Cell {
  constructor(
    public char: string = " ",
    public fg: string | null = null,
    public bg: string | null = null,
  ) {}

  equals(other: Cell): boolean {
    return this.char === other.char && this.fg === other.fg && this.bg === other.bg;
  }
}

export class ScreenBuffer {
  private grid: Cell[][];
  public width: number;
  public height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.grid = [];
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const newGrid: Cell[][] = Array.from(
      { length: height },
      (_, y) => Array.from({ length: width }, (_, x) => this.grid[y]?.[x] ?? new Cell()),
    );
    this.grid = newGrid;
  }

  clear(): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.grid[y]![x] = new Cell();
      }
    }
  }

  getCell(x: number, y: number): Cell | undefined {
    return this.grid[y]?.[x];
  }

  setCell(x: number, y: number, cell: Cell): void {
    if (y >= 0 && y < this.height && x >= 0 && x < this.width) {
      this.grid[y]![x] = cell;
    }
  }

  write(x: number, y: number, text: string, fg: string | null = null, bg: string | null = null): number {
    let currentX = x;
    for (const char of text) {
      if (currentX >= this.width) break;
      const charWidth = Bun.stringWidth(char);
      this.setCell(currentX, y, new Cell(char, fg, bg));
      for (let i = 1; i < charWidth; i++) {
        if (currentX + i < this.width) {
          this.setCell(currentX + i, y, new Cell("", fg, bg));
        }
      }
      currentX += charWidth;
    }
    return currentX;
  }
}

function diffBuffers(prev: ScreenBuffer, next: ScreenBuffer): string {
  let output = "";
  let lastFg: string | null = null;
  let lastBg: string | null = null;

  const height = next.height;
  const width = next.width;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const prevCell = prev.getCell(x, y) || new Cell();
      const nextCell = next.getCell(x, y) || new Cell();

      if (!prevCell.equals(nextCell)) {
        output += `\x1b[${y + 1};${x + 1}H`;
        if (nextCell.fg !== lastFg || nextCell.bg !== lastBg) {
          let colorOutput = "";
          if (nextCell.fg !== lastFg) colorOutput += nextCell.fg ?? "\x1b[39m";
          if (nextCell.bg !== lastBg) colorOutput += nextCell.bg ?? "\x1b[49m";
          output += colorOutput;
          lastFg = nextCell.fg;
          lastBg = nextCell.bg;
        }
        output += nextCell.char;
      }
    }
  }
  return output;
}

export type TuiEvent =
  | { type: "keypress"; key: Buffer }
  | { type: "resize"; width: number; height: number };

export abstract class Widget {
  public children: Widget[] = [];
  public parent: Widget | null = null;
  protected _actualArea: Rect = { x: 0, y: 0, width: 0, height: 0 };
  protected isFocused = false;

  public get actualArea(): Rect {
    return this._actualArea;
  }

  public addChild(widget: Widget): void {
    widget.parent = this;
    this.children.push(widget);
  }

  public layout(area: Rect): void {
    this._actualArea = area;
    this.children.forEach(child => child.layout(area));
  }

  public render(buffer: ScreenBuffer, focusedWidget: Widget | null): void {
    this.isFocused = this === focusedWidget;
    for (const child of this.children) {
      child.render(buffer, focusedWidget);
    }
  }

  public handleEvent(event: TuiEvent): boolean {
    for (let i = this.children.length - 1; i >= 0; i--) {
      if (this.children[i]!.handleEvent(event)) {
        return true;
      }
    }
    return false;
  }

  public getCursorPosition(): { x: number; y: number } | null {
    for (const child of this.children) {
      const pos = child.getCursorPosition();
      if (pos) return pos;
    }
    return null;
  }

  public isFocusable(): boolean {
    return false;
  }

  public collectFocusableWidgets(collection: Widget[]): void {
    if (this.isFocusable()) {
      collection.push(this);
    }
    for (const child of this.children) {
      child.collectFocusableWidgets(collection);
    }
  }
}

export class VStack extends Widget {
  constructor(children: Widget[]) {
    super();
    children.forEach(child => this.addChild(child));
  }

  override layout(area: Rect): void {
    this._actualArea = area;
    let currentY = area.y;
    const staticHeightChildren: { widget: Widget; height: number }[] = [];
    const flexChildren: Widget[] = [];
    let totalStaticHeight = 0;

    for (const child of this.children) {
      const height = (child as any).getStaticHeight?.(area.width) ?? null;
      if (height !== null) {
        staticHeightChildren.push({ widget: child, height });
        totalStaticHeight += height;
      } else {
        flexChildren.push(child);
      }
    }

    const remainingHeight = Math.max(0, area.height - totalStaticHeight);
    const flexHeight = flexChildren.length > 0 ? Math.floor(remainingHeight / flexChildren.length) : 0;
    let flexUsedHeight = 0;

    for (const child of this.children) {
      const staticChild = staticHeightChildren.find(c => c.widget === child);
      if (staticChild) {
        const childArea: Rect = { x: area.x, y: currentY, width: area.width, height: staticChild.height };
        child.layout(childArea);
        currentY += staticChild.height;
      } else if (flexChildren.includes(child)) {
        const isLastFlex = flexChildren.indexOf(child) === flexChildren.length - 1;
        const height = isLastFlex ? remainingHeight - flexUsedHeight : flexHeight;
        const childArea: Rect = { x: area.x, y: currentY, width: area.width, height: height };
        child.layout(childArea);
        currentY += height;
        flexUsedHeight += height;
      }
    }
  }
}

export class CLIApplication<TState> {
  public state: TState;
  private renderFn: (state: TState) => Widget;
  private rootWidget: Widget | null = null;
  private focusedWidget: Widget | null = null;
  private isRunning = false;
  private resolveExit?: () => void;
  private frontBuffer: ScreenBuffer;
  private backBuffer: ScreenBuffer;
  private _drawRequested = false;

  constructor(initialState: TState, renderFn: (state: TState) => Widget) {
    this.state = initialState;
    this.renderFn = renderFn;
    const { columns, rows } = stdout;
    this.frontBuffer = new ScreenBuffer(columns, rows);
    this.backBuffer = new ScreenBuffer(columns, rows);
  }

  public setState(updater: (prevState: TState) => TState): void {
    this.state = updater(this.state);
    this.requestDraw();
  }

  private findFocus(): void {
    if (!this.rootWidget) return;
    const focusable: Widget[] = [];
    this.rootWidget.collectFocusableWidgets(focusable);

    if (!this.focusedWidget || !focusable.includes(this.focusedWidget)) {
      this.focusedWidget = focusable[0] ?? null;
    }
  }

  requestDraw(): void {
    if (!this._drawRequested) {
      this._drawRequested = true;
      setImmediate(() => this.draw());
    }
  }

  private draw(): void {
    if (!this.isRunning) return;
    this._drawRequested = false;

    this.rootWidget = this.renderFn(this.state);
    this.findFocus();

    const { columns, rows } = stdout;
    this.rootWidget.layout({ x: 0, y: 0, width: columns, height: rows });

    [this.frontBuffer, this.backBuffer] = [this.backBuffer, this.frontBuffer];
    this.backBuffer.clear();
    this.rootWidget.render(this.backBuffer, this.focusedWidget);

    const diff = diffBuffers(this.frontBuffer, this.backBuffer);
    stdout.write("\x1b[?25l" + diff);

    const cursorPos = this.focusedWidget?.getCursorPosition() ?? null;
    if (cursorPos) {
      stdout.write(`\x1b[${cursorPos.y + 1};${cursorPos.x + 1}H`);
    } else {
      stdout.write(`\x1b[${rows};${1}H`);
    }
    stdout.write("\x1b[?25h");
  }

  async run(): Promise<void> {
    this.isRunning = true;
    stdin.setRawMode(true);
    stdin.resume();

    const onData = async (key: Buffer) => {
      if (key[0] === 3) { // Ctrl+C
        this.stop();
        return;
      }
      const event: TuiEvent = { type: "keypress", key };
      if (this.rootWidget?.handleEvent(event)) {
        // State update should have called requestDraw, but we call it as a fallback.
        this.requestDraw();
      }
    };
    stdin.on("data", onData);

    const onResize = () => {
      const { columns, rows } = stdout;
      this.frontBuffer.resize(columns, rows);
      this.backBuffer.resize(columns, rows);
      this.frontBuffer.clear();
      this.requestDraw();
    };
    stdout.on("resize", onResize);

    console.clear();
    this.requestDraw();

    return new Promise(resolve => {
      this.resolveExit = () => {
        stdin.removeListener("data", onData);
        stdout.removeListener("resize", onResize);
        stdin.setRawMode(false);
        stdin.pause();
        console.clear();
        resolve();
      };
    });
  }

  stop(): void {
    if (this.isRunning) {
      this.isRunning = false;
      this.resolveExit?.();
    }
  }
}
