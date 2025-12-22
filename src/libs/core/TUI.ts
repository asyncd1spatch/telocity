import type { Cell, InputTheme, Rect, Style } from "../types/index.ts";
import { AppStateSingleton, stringWidth } from "./context.ts";

const ANSI = {
  clear: "\x1b[2J",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  reset: "\x1b[0m",
  moveTo: (x: number, y: number) => `\x1b[${y + 1};${x + 1}H`,

  stylesAreEqual: (a?: Style, b?: Style) => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold;
  },

  fromStyle: (s?: Style) => {
    if (!s) return "\x1b[0m";
    let out = "\x1b[0m";
    if (s.bold) out += "\x1b[1m";
    if (s.fg !== undefined) out += `\x1b[38;5;${s.fg}m`;
    if (s.bg !== undefined) out += `\x1b[48;5;${s.bg}m`;
    return out;
  },
};

export const StrUtils = {
  width: (s: string) => stringWidth(s),
  truncate: (s: string, maxWidth: number) => {
    if (stringWidth(s) <= maxWidth) return s;
    const segmenter = AppStateSingleton.getInstance().segmenter;
    let acc = "";
    let currentWidth = 0;
    for (const seg of segmenter.segment(s)) {
      const w = stringWidth(seg.segment);
      if (currentWidth + w > maxWidth) break;
      acc += seg.segment;
      currentWidth += w;
    }
    return acc;
  },
  wrap: (text: string, maxWidth: number): string[] => {
    if (maxWidth <= 0) return [];
    const lines: string[] = [];
    const paragraphs = text.split("\n");
    const segmenter = AppStateSingleton.getInstance().segmenter;

    for (const para of paragraphs) {
      if (para === "") {
        lines.push("");
        continue;
      }
      const words = para.split(" ");
      let currentLine = "";

      for (let i = 0; i < words.length; i++) {
        const word = words[i] || "";
        const isStartOfLine = currentLine === "";
        const prefix = isStartOfLine ? "" : " ";
        const potentialLine = currentLine + prefix + word;

        if (stringWidth(potentialLine) <= maxWidth) {
          currentLine = potentialLine;
        } else {
          if (!isStartOfLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = word;
          }
          while (stringWidth(currentLine) > maxWidth) {
            let subLine = "";
            let remaining = "";
            let wAcc = 0;
            let cut = false;
            for (const seg of segmenter.segment(currentLine)) {
              const sw = stringWidth(seg.segment);
              if (!cut && wAcc + sw <= maxWidth) {
                subLine += seg.segment;
                wAcc += sw;
              } else {
                cut = true;
                remaining += seg.segment;
              }
            }
            lines.push(subLine);
            currentLine = remaining;
          }
        }
      }
      lines.push(currentLine);
    }
    return lines;
  },
};

export class ScreenBuffer {
  private back: Cell[][] = [];
  private front: Cell[][] = [];
  private readonly segmenter: Intl.Segmenter;
  public width: number = 0;
  public height: number = 0;

  constructor() {
    this.segmenter = AppStateSingleton.getInstance().segmenter;
    this.resize(process.stdout.columns, process.stdout.rows);
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    const createBuffer = () =>
      Array.from({ length: h }, () =>
        Array.from({ length: w }, () => ({ char: " ", style: undefined })),
      );
    this.back = createBuffer();
    this.front = Array.from({ length: h }, () =>
      Array.from({ length: w }, () => ({ char: "", style: undefined })),
    );
  }

  public clear() {
    for (let y = 0; y < this.height; y++) {
      const row = this.back[y];
      if (!row) continue;
      for (let x = 0; x < this.width; x++) {
        row[x] = { char: " ", style: undefined };
      }
    }
  }

  public draw(x: number, y: number, text: string, style?: Style) {
    if (y < 0 || y >= this.height) return;

    const bufferRow = this.back[y];
    if (!bufferRow) return;

    let currentX = x;

    for (const seg of this.segmenter.segment(text)) {
      const charWidth = stringWidth(seg.segment);
      if (currentX + charWidth > this.width) break;

      if (currentX >= 0) {
        bufferRow[currentX] = {
          char: seg.segment,
          style: style ? { ...style } : undefined,
        };

        if (charWidth > 1) {
          for (let i = 1; i < charWidth; i++) {
            if (currentX + i < this.width) {
              bufferRow[currentX + i] = {
                char: "",
                style: style ? { ...style } : undefined,
              };
            }
          }
        }
      }
      currentX += charWidth;
    }
  }

  public flush() {
    let output = "";
    let lastAnsi = "";
    let cursorX = -1;
    let cursorY = -1;

    for (let y = 0; y < this.height; y++) {
      const backRow = this.back[y];
      const frontRow = this.front[y];
      if (!backRow || !frontRow) continue;

      for (let x = 0; x < this.width; x++) {
        const backCell = backRow[x];
        const frontCell = frontRow[x];
        if (!backCell || !frontCell) continue;

        const styleChanged = !ANSI.stylesAreEqual(
          backCell.style,
          frontCell.style,
        );
        const charChanged = backCell.char !== frontCell.char;

        if (styleChanged || charChanged) {
          if (y !== cursorY || x !== cursorX) {
            output += ANSI.moveTo(x, y);
            cursorY = y;
            cursorX = x;
          }

          const newAnsi = ANSI.fromStyle(backCell.style);
          if (newAnsi !== lastAnsi) {
            output += newAnsi;
            lastAnsi = newAnsi;
          }

          if (backCell.char !== "") {
            output += backCell.char;
            cursorX += stringWidth(backCell.char);
          }

          frontRow[x] = {
            char: backCell.char,
            style: backCell.style,
          };
        }
      }
    }

    if (output.length > 0) {
      process.stdout.write(output);
    }
  }
}

export abstract class Widget {
  public children: Widget[] = [];
  public parent: Widget | null = null;
  public bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  public isFocused = false;

  public flex?: number;
  public fixedHeight?: number;

  constructor(props: Partial<Widget> = {}) {
    Object.assign(this, props);
  }

  add(child: Widget) {
    child.parent = this;
    this.children.push(child);
    return this;
  }

  public preferredHeight(_width: number): number {
    if (this.fixedHeight) return this.fixedHeight;
    return 1;
  }

  abstract layout(available: Rect): void;
  abstract render(screen: ScreenBuffer): void;

  public onKey(_key: string): boolean {
    return false;
  }
}

export class Box extends Widget {
  public child: Widget;
  public style?: Style;

  constructor(child: Widget, style?: Style) {
    super();
    this.child = child;
    this.style = style;
    this.add(child);
  }

  override preferredHeight(width: number): number {
    return this.child.preferredHeight(width);
  }

  layout(available: Rect): void {
    this.bounds = available;
    this.child.layout(available);
  }

  render(screen: ScreenBuffer): void {
    if (this.style?.bg) {
      const line = " ".repeat(this.bounds.width);
      for (let y = 0; y < this.bounds.height; y++) {
        screen.draw(this.bounds.x, this.bounds.y + y, line, this.style);
      }
    }
    this.child.render(screen);
  }

  override onKey(key: string): boolean {
    return this.child.onKey(key);
  }
}

export class VBox extends Widget {
  override preferredHeight(width: number): number {
    let h = 0;
    for (const c of this.children) h += c.preferredHeight(width);
    return h;
  }

  layout(available: Rect): void {
    this.bounds = available;
    if (this.children.length === 0) return;

    let usedHeight = 0;
    let flexTotal = 0;

    for (const c of this.children) {
      if (c.fixedHeight) usedHeight += c.fixedHeight;
      else if (c.flex) flexTotal += c.flex;
      else usedHeight += c.preferredHeight(available.width);
    }

    const remainingHeight = Math.max(0, available.height - usedHeight);
    let currentY = available.y;

    for (const c of this.children) {
      let h = 0;
      if (c.fixedHeight) {
        h = c.fixedHeight;
      } else if (c.flex) {
        h = Math.floor((c.flex / flexTotal) * remainingHeight);
      } else {
        h = c.preferredHeight(available.width);
      }

      c.layout({
        x: available.x,
        y: currentY,
        width: available.width,
        height: h,
      });

      currentY += h;
    }
  }

  render(screen: ScreenBuffer): void {
    for (const c of this.children) c.render(screen);
  }
}

export class Label extends Widget {
  public text: string;
  public align: "left" | "center" | "right";
  public style?: Style;

  constructor(
    text: string,
    align: "left" | "center" | "right" = "left",
    style?: Style,
  ) {
    super();
    this.text = text;
    this.align = align;
    this.style = style;
  }

  override preferredHeight(_width: number): number {
    return this.text.split("\n").length;
  }

  layout(available: Rect): void {
    this.bounds = available;
    this.fixedHeight = this.preferredHeight(available.width);
  }

  render(screen: ScreenBuffer): void {
    const lines = this.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = StrUtils.truncate(lines[i] || "", this.bounds.width);
      const w = StrUtils.width(line);
      let x = this.bounds.x;

      if (this.align === "center") x += Math.floor((this.bounds.width - w) / 2);
      else if (this.align === "right") x += this.bounds.width - w;

      if (this.bounds.y + i < this.bounds.y + this.bounds.height) {
        screen.draw(x, this.bounds.y + i, line, this.style);
      }
    }
  }
}

export class ScrollableView extends Widget {
  public content: string = "";
  private scrollY = 0;
  // private scrollX = 0; /* unused for now */

  public styles: {
    borderFocused: Style;
    borderBlurred: Style;
    text: Style;
  };

  constructor(content: string, props: Partial<ScrollableView> = {}) {
    super({ flex: 1, ...props });
    this.content = content;

    const defaults = {
      borderFocused: { fg: 14 },
      borderBlurred: { fg: 240 },
      text: { fg: 252 },
    };

    this.styles = { ...defaults, ...props.styles };
  }

  layout(available: Rect): void {
    this.bounds = available;
  }

  override onKey(key: string): boolean {
    const height = Math.max(0, this.bounds.height - 2);
    const lines = StrUtils.wrap(
      this.content,
      Math.max(0, this.bounds.width - 2),
    );
    const maxScroll = Math.max(0, lines.length - height);

    if (key === "j" || key === "\x1b[B") {
      this.scrollY = Math.min(this.scrollY + 1, maxScroll);
      return true;
    }
    if (key === "k" || key === "\x1b[A") {
      this.scrollY = Math.max(this.scrollY - 1, 0);
      return true;
    }
    return false;
  }

  render(screen: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;
    const borderStyle = this.isFocused
      ? this.styles.borderFocused
      : this.styles.borderBlurred;

    const hBar = "─".repeat(width - 2);
    screen.draw(x, y, `┌${hBar}┐`, borderStyle);
    for (let i = 1; i < height - 1; i++) {
      screen.draw(x, y + i, "│", borderStyle);
      screen.draw(x + width - 1, y + i, "│", borderStyle);
    }
    screen.draw(x, y + height - 1, `└${hBar}┘`, borderStyle);

    const viewportWidth = Math.max(0, width - 2);
    const viewportHeight = Math.max(0, height - 2);
    const lines = StrUtils.wrap(this.content, viewportWidth);

    for (let i = 0; i < viewportHeight; i++) {
      const lineIndex = this.scrollY + i;
      if (lineIndex < lines.length) {
        screen.draw(x + 1, y + 1 + i, lines[lineIndex] || "", this.styles.text);
      }
    }
  }
}

export class Input extends Widget {
  public value = "";
  public placeholder = "";
  public onSubmit?: (value: string) => void;

  public styles: InputTheme;

  constructor(props: Partial<Input> = {}) {
    super({ fixedHeight: 3, ...props });

    const defaults: InputTheme = {
      focusedBorder: { fg: 14 },
      blurredBorder: { fg: 240 },
      text: { fg: 255 },
      placeholder: { fg: 240 },
      cursorSymbol: "█",
    };

    this.styles = { ...defaults, ...props.styles };
  }

  override preferredHeight(width: number): number {
    const contentWidth = Math.max(0, width - 2);
    const wrapped = StrUtils.wrap(this.value + " ", contentWidth);
    const lines = Math.min(wrapped.length, 3);
    return Math.max(1, lines) + 2;
  }

  layout(available: Rect): void {
    this.fixedHeight = this.preferredHeight(available.width);
    this.bounds = available;
  }

  override onKey(key: string): boolean {
    const isAltEnter = key === "\x1b\r" || key === "\x1b\n";
    const isCtrlEnter = key === "\n"; // Ctrl+J

    if (key === "\r") {
      if (this.onSubmit) this.onSubmit(this.value);
      return true;
    }

    if (isAltEnter || isCtrlEnter) {
      this.value += "\n";
      return true;
    }

    if (key === "\x7f") {
      this.value = this.value.slice(0, -1);
      return true;
    } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
      this.value += key;
      return true;
    }

    return false;
  }

  render(screen: ScreenBuffer): void {
    const { x, y, width, height } = this.bounds;

    const borderStyle = this.isFocused
      ? this.styles.focusedBorder
      : this.styles.blurredBorder;

    const hBar = "─".repeat(width);
    screen.draw(x, y, hBar, borderStyle);
    screen.draw(x, y + height - 1, hBar, borderStyle);
    for (let i = 1; i < height - 1; i++) {
      screen.draw(x, y + i, "│", borderStyle);
      screen.draw(x + width - 1, y + i, "│", borderStyle);
    }

    const textStyle = this.value ? this.styles.text : this.styles.placeholder;
    const contentWidth = width - 2;
    const viewportHeight = Math.max(1, height - 2);

    const emptyLine = " ".repeat(contentWidth);
    for (let i = 0; i < viewportHeight; i++) {
      screen.draw(x + 1, y + 1 + i, emptyLine, textStyle);
    }

    const cursorChar = this.isFocused ? this.styles.cursorSymbol : "";
    const fullText = this.value + cursorChar;
    const allLines = StrUtils.wrap(fullText, contentWidth);

    let startLine = 0;
    if (allLines.length > viewportHeight) {
      startLine = allLines.length - viewportHeight;
    }

    for (let i = 0; i < viewportHeight; i++) {
      const lineIdx = startLine + i;
      if (allLines[lineIdx] !== undefined) {
        if (!this.value) {
          screen.draw(
            x + 1,
            y + 1 + i,
            StrUtils.truncate(this.placeholder, contentWidth),
            textStyle,
          );
          if (i === 0 && this.isFocused)
            screen.draw(x + 1, y + 1, cursorChar, textStyle);
          break;
        } else {
          screen.draw(x + 1, y + 1 + i, allLines[lineIdx], textStyle);
        }
      }
    }
  }
}

export class TuiApp {
  private buffer: ScreenBuffer;
  private root: Widget;
  private modals: Widget[] = [];
  private focusIndex = 0;
  private focusableWidgets: Widget[] = [];

  constructor(root: Widget) {
    this.buffer = new ScreenBuffer();
    this.root = root;
    this.setup();
  }

  public addModal(w: Widget) {
    this.modals.push(w);
    this.recalculateFocus();
    this.render();
  }

  public closeModal() {
    this.modals.pop();
    this.recalculateFocus();
    this.render();
  }

  private setup() {
    process.on("SIGWINCH", () => {
      this.render();
    });
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", this.handleInput.bind(this));
    this.recalculateFocus();
    process.stdout.write(ANSI.clear + ANSI.hideCursor);
    this.render();
  }

  private recalculateFocus() {
    this.focusableWidgets.forEach((w) => (w.isFocused = false));
    this.focusableWidgets = [];

    const modal =
      this.modals.length > 0 ? this.modals[this.modals.length - 1] : undefined;
    const activeRoot = modal ?? this.root;

    this.collectFocusables(activeRoot);

    const first = this.focusableWidgets[0];
    if (first) {
      this.focusIndex = 0;
      first.isFocused = true;
    }
  }

  private collectFocusables(w: Widget) {
    if (w instanceof Input || w instanceof ScrollableView) {
      this.focusableWidgets.push(w);
    }
    for (const c of w.children) this.collectFocusables(c);
  }

  private handleInput(data: Buffer) {
    const key = data.toString();
    if (key === "\u0003") {
      process.stdout.write(ANSI.showCursor + ANSI.reset + ANSI.clear);
      process.exit(0);
    }
    if (key === "\t") {
      if (this.focusableWidgets.length > 0) {
        const current = this.focusableWidgets[this.focusIndex];
        if (current) current.isFocused = false;
        this.focusIndex = (this.focusIndex + 1) % this.focusableWidgets.length;
        const next = this.focusableWidgets[this.focusIndex];
        if (next) next.isFocused = true;
        this.render();
      }
      return;
    }

    const activeWidget = this.focusableWidgets[this.focusIndex];
    let handled = false;
    if (activeWidget) handled = activeWidget.onKey(key);

    if (!handled) {
      const modal =
        this.modals.length > 0
          ? this.modals[this.modals.length - 1]
          : undefined;
      const topLayer = modal ?? this.root;

      if (key === "\x1b" && this.modals.length > 0) {
        this.closeModal();
        handled = true;
      } else if (activeWidget !== topLayer) {
        handled = topLayer.onKey(key);
      }
    }
    if (handled || activeWidget) this.render();
  }

  private render() {
    this.buffer.resize(process.stdout.columns, process.stdout.rows);
    this.buffer.clear();
    this.root.layout({
      x: 0,
      y: 0,
      width: this.buffer.width,
      height: this.buffer.height,
    });
    this.root.render(this.buffer);

    this.modals.forEach((modal) => {
      const mw = Math.min(60, this.buffer.width - 4);
      const mh = modal.preferredHeight(mw);

      const mx = Math.floor((this.buffer.width - mw) / 2);
      const my = Math.floor((this.buffer.height - mh) / 2);

      modal.layout({ x: mx, y: my, width: mw, height: mh });
      modal.render(this.buffer);
    });
    this.buffer.flush();
  }
}
