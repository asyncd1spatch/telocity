import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  AppStateSingleton,
  blue,
  CLIApplication,
  config as appConfig,
  createError,
  customParseArgs as parseArgs,
  errlog,
  generateHelpText,
  LineWrapper,
  log,
  red,
  ScreenBuffer,
  simpleTemplate,
  VStack,
  Widget,
  wrapText,
  yellow,
  yellowBright,
} from "../libs/core";
import { buildImageContent, getPresetHelpText, LLM, stripGarbageNewLines, validateFiles } from "../libs/LLM";
import { countTokens, shutdownTokenCounter } from "../libs/thirdparty";
import type {
  ChatSession,
  Command,
  ConfigModelVariant,
  ImageContentPart,
  MessageContent,
  TextContentPart,
} from "../libs/types";
import TcCommand from "./tccommand";

const CHAT_FILE_EXTENSION = ".json";
const DEFAULT_CONTEXT_LIMIT = 8192;

let appState: any = null;

function formatMessageContent(content: MessageContent, truncate = 0): string {
  let text = typeof content === "string"
    ? content
    : content.filter(p => p.type === "text").map(p => (p as TextContentPart).text).join("\n");
  if (typeof content !== "string") {
    const imageCount = content.filter(p => p.type === "image_url").length;
    if (imageCount > 0 && appState) text += simpleTemplate(appState.s.m.c.ch.imageCountSuffix, { Count: imageCount });
  }
  if (truncate > 0 && Bun.stringWidth(text) > truncate) {
    let truncated = "";
    for (const char of text) {
      if (Bun.stringWidth(truncated + char + "...") > truncate) break;
      truncated += char;
    }
    return truncated + "...";
  }
  return text;
}
function getTotalTokens(session: ChatSession): number {
  return session.messages.reduce((s, m) => s + m.tokens, 0);
}

interface BrowseState {
  cursorIndex: number;
  viewingMessageIndex: number | null;
  viewingScrollOffset: number;
  hasChanges: boolean;
}

class ChatController {
  public session: ChatSession;
  public sessionPath: string;
  public mode: "chat" | "browse" | "help" = "chat";
  public statusMessage: { text: string; type: "info" | "error" } | null = null;
  public scrollOffset = 0;
  public streamingAssistantText: string = "";
  public helpText: string | null = null;
  public inputBuffer: string = "";
  public browseState: BrowseState = {
    cursorIndex: 1,
    viewingMessageIndex: null,
    viewingScrollOffset: 0,
    hasChanges: false,
  };
  public hasUnsavedChanges = false;

  private app: CLIApplication<ChatController>;
  private statusMessageTimeout: Timer | null = null;
  private isStreaming = false;
  private _prependedText: string = "";
  private _pendingImages: string[] = [];
  private _pendingText: string = "";

  constructor(
    session: ChatSession,
    sessionPath: string,
    app: CLIApplication<ChatController>,
    initialContent?: { prep: string; file: string; images: string[] },
  ) {
    this.session = session;
    this.sessionPath = sessionPath;
    this.app = app;
    if (initialContent) {
      this._prependedText = initialContent.prep;
      this._pendingText = initialContent.file;
      this._pendingImages = initialContent.images;
    }
  }

  public setState(updater: (draft: ChatController) => void): void {
    this.app.setState(prevState => {
      updater(prevState);
      return prevState;
    });
  }

  public setStatus(text: string, type: "info" | "error" = "info", durationMs = 3000): void {
    this.setState(draft => {
      draft.statusMessage = { text, type };
      if (draft.statusMessageTimeout) clearTimeout(draft.statusMessageTimeout);
      draft.statusMessageTimeout = setTimeout(() => {
        this.setState(d => {
          d.statusMessage = null;
        });
      }, durationMs);
    });
  }

  public setInputBuffer(text: string): void {
    this.setState(d => {
      d.inputBuffer = text;
    });
  }

  async submitInput(): Promise<void> {
    const text = this.inputBuffer.trim();
    if (text || this._pendingImages.length > 0 || this._pendingText) {
      this.setInputBuffer("");
      await this.handleUserInput(text);
    }
  }

  public handleScroll(
    direction: "up" | "down" | "pageup" | "pagedown",
    viewHeight: number,
    totalLines: number,
  ): boolean {
    if (this.isStreaming) return false;
    const oldOffset = this.scrollOffset;
    const pageJump = Math.max(1, viewHeight - 1);
    const maxOffset = Math.max(0, totalLines - viewHeight);
    let newOffset = oldOffset;

    switch (direction) {
      case "up":
        newOffset = Math.min(oldOffset + 1, maxOffset);
        break;
      case "down":
        newOffset = Math.max(0, oldOffset - 1);
        break;
      case "pageup":
        newOffset = Math.min(oldOffset + pageJump, maxOffset);
        break;
      case "pagedown":
        newOffset = Math.max(0, oldOffset - pageJump);
        break;
    }

    if (newOffset !== oldOffset) {
      this.setState(draft => {
        draft.scrollOffset = newOffset;
      });
      return true;
    }
    return false;
  }

  async handleUserInput(input: string): Promise<void> {
    if (input.startsWith("/")) {
      await this.handleSlashCommand(input);
      return;
    }

    const userMessageContent = this.buildUserMessage(input);
    const textForTokenizing = typeof userMessageContent === "string"
      ? userMessageContent
      : userMessageContent.filter(p => p.type === "text").map(p => (p as TextContentPart).text).join("\n");
    const tokens = await countTokens(this.session.metadata.tokenizerName, textForTokenizing);

    this.setState(draft => {
      draft.session.messages.push({ role: "user", content: userMessageContent, tokens });
    });
    this.clearPendingAttachments();

    await this._generateLlmResponse();
  }

  async handleSlashCommand(input: string): Promise<void> {
    const [command, ...args] = input.slice(1).split(/\s+/);
    switch (command) {
      case "exit":
      case "quit":
        this.app.stop();
        break;
      case "help":
        this.setState(d => {
          d.mode = "help";
          d.helpText = appState.s.m.c.ch.availableCommands;
        });
        break;
      case "browse":
        this.setState(d => {
          d.mode = "browse";
          d.browseState.cursorIndex = Math.max(1, d.session.messages.length - 1);
          d.browseState.hasChanges = false;
        });
        break;
      case "forcegen":
        await this._generateLlmResponse();
        break;
      case "stats":
        this.displayStats();
        break;
      case "delete": {
        const index = parseInt(args[0]!, 10);
        await this.deleteMessage(index);
        break;
      }
      case "insert": {
        const filePath = args[0];
        if (!filePath) {
          this.setStatus(appState.s.e.c.ch.insertUsage, "error");
          break;
        }
        const file = Bun.file(filePath);
        if (!(await file.exists())) {
          this.setStatus(simpleTemplate(appState.s.e.lllm.fileNotFound, { FilePath: filePath }), "error");
          break;
        }
        const ext = path.extname(filePath).toLowerCase();
        if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
          const images = await buildImageContent(filePath);
          this.setState(d => {
            d._pendingImages.push(...images);
          });
          this.setStatus(simpleTemplate(appState.s.m.c.ch.imageQueued, { FilePath: filePath }), "info");
        } else {
          const fileContent = await file.text();
          this.setState(d => {
            d._pendingText +=
              simpleTemplate(appState.s.m.c.ch.insertedFileHeader, { FileName: path.basename(filePath) })
              + fileContent;
          });
          this.setStatus(simpleTemplate(appState.s.m.c.ch.textQueued, { FilePath: filePath }), "info");
        }
        break;
      }
      default:
        this.setStatus(simpleTemplate(appState.s.e.c.ch.unknownCommand, { Command: command ?? "(unknown)" }), "error");
        break;
    }
  }

  public async deleteMessage(index: number): Promise<void> {
    if (isNaN(index) || index <= 0 || index >= this.session.messages.length) {
      this.setStatus(
        simpleTemplate(appState.s.e.c.ch.invalidDeleteIndex, { Count: this.session.messages.length - 1 }),
        "error",
      );
      return;
    }

    this.setState(d => {
      d.session.messages.splice(index, 1);
      d.hasUnsavedChanges = true;
      if (d.mode === "browse") {
        d.browseState.hasChanges = true;
        if (d.browseState.cursorIndex >= index) {
          d.browseState.cursorIndex = Math.max(1, d.browseState.cursorIndex - 1);
        }
      }
    });

    this.setStatus(simpleTemplate(appState.s.m.c.ch.deletedMessage, { Index: index }), "info");
    if (this.mode !== "browse") {
      await this.recalculateTokens();
    }
  }

  public browseMoveCursor(direction: "up" | "down" | "pageup" | "pagedown", pageHeight: number): void {
    this.setState(d => {
      const maxIndex = Math.max(1, d.session.messages.length - 1);
      const pageJump = Math.max(1, pageHeight);
      switch (direction) {
        case "up":
          d.browseState.cursorIndex = Math.max(1, d.browseState.cursorIndex - 1);
          break;
        case "down":
          d.browseState.cursorIndex = Math.min(maxIndex, d.browseState.cursorIndex + 1);
          break;
        case "pageup":
          d.browseState.cursorIndex = Math.max(1, d.browseState.cursorIndex - pageJump);
          break;
        case "pagedown":
          d.browseState.cursorIndex = Math.min(maxIndex, d.browseState.cursorIndex + pageJump);
          break;
      }
    });
  }

  public browseViewMessage(): void {
    this.setState(d => {
      if (d.browseState.cursorIndex > 0) {
        d.browseState.viewingMessageIndex = d.browseState.cursorIndex;
        d.browseState.viewingScrollOffset = 0;
      }
    });
  }

  public browseExitView(): void {
    this.setState(d => {
      d.browseState.viewingMessageIndex = null;
      d.browseState.viewingScrollOffset = 0;
    });
  }

  public exitBrowseMode(): void {
    const madeChanges = this.browseState.hasChanges;
    this.setState(d => {
      d.mode = "chat";
      d.browseState.hasChanges = false;
    });
    this.setStatus(appState.s.m.c.ch.exitedBrowseMode, "info");
    if (madeChanges) {
      this.recalculateTokens();
    }
  }

  private displayStats(): void {
    const { paramsKey, sessionType, modelName, contextLimit } = this.session.metadata;
    const totalTokens = getTotalTokens(this.session);
    const usage = ((totalTokens / contextLimit) * 100).toFixed(2);
    const stats = simpleTemplate(appState.s.m.c.ch.statsDisplay, {
      Preset: paramsKey,
      Mode: sessionType || "instruct",
      Model: modelName || "Default",
      Messages: this.session.messages.length - 1,
      Tokens: totalTokens,
      Limit: contextLimit,
      Usage: usage,
    });
    this.setStatus(stats, "info", 5000);
  }

  private buildUserMessage(userInput: string): MessageContent {
    const fullText = [this._prependedText, userInput, this._pendingText].filter(Boolean).join("\n\n");
    if (this._pendingImages.length === 0) return fullText;
    const content: (TextContentPart | ImageContentPart)[] = [{ type: "text", text: fullText }];
    for (const u of this._pendingImages) content.push({ type: "image_url", image_url: { url: u } });
    return content;
  }

  private clearPendingAttachments(): void {
    this.setState(d => {
      d._prependedText = "";
      d._pendingImages = [];
      d._pendingText = "";
    });
  }

  private async recalculateTokens(): Promise<void> {
    for (const message of this.session.messages) {
      const text = formatMessageContent(message.content);
      message.tokens = await countTokens(this.session.metadata.tokenizerName, text);
    }
    // await this.saveSession(); defer saving on exit.
  }

  private async _generateLlmResponse(): Promise<void> {
    const totalTokensBefore = getTotalTokens(this.session);
    if (totalTokensBefore >= this.session.metadata.contextLimit) {
      this.setStatus(
        simpleTemplate(appState.s.e.c.ch.contextLimitExceeded, {
          Total: totalTokensBefore,
          Limit: this.session.metadata.contextLimit,
        }),
        "error",
      );
      if (this.isStreaming) {
        this.setState(draft => {
          draft.session.messages.pop();
        });
      }
      return;
    }

    this.setState(draft => {
      draft.scrollOffset = 0;
      draft.isStreaming = true;
      draft.streamingAssistantText = "";
    });

    const llm = this.getLLMFromSession();
    const messagesForLLM = this.session.messages.map(({ role, content }) => ({ role, content }));

    const lineWrapper = new LineWrapper(appState.TERMINAL_WIDTH, 4096, {
      onChunk: async (chunk: string) => {
        this.setState(draft => {
          draft.streamingAssistantText += chunk;
        });
      },
    });

    let responseText = "";
    try {
      await llm.completion(messagesForLLM, {
        verbose: async (chunk: string) => {
          await lineWrapper.write(chunk);
          responseText += chunk;
        },
      });
      await lineWrapper.flush();
    } catch (err) {
      this.setState(draft => {
        draft.streamingAssistantText = "";
        draft.isStreaming = false;
        const lastMessage = draft.session.messages.at(-1);
        if (lastMessage && lastMessage.role === "user") {
          draft.session.messages.pop();
        }
      });
      this.setStatus(String(err), "error");
      return;
    }

    const finalResponse = this.streamingAssistantText || responseText;

    this.setState(draft => {
      draft.streamingAssistantText = "";
      draft.isStreaming = false;
    });

    if (finalResponse) {
      const assistantTokens = await countTokens(this.session.metadata.tokenizerName, finalResponse);
      this.setState(draft => {
        draft.session.messages.push({ role: "assistant", content: finalResponse, tokens: assistantTokens });
        draft.hasUnsavedChanges = true;
      });
    }
  }

  private getLLMFromSession(): LLM {
    const { paramsKey, sessionType, modelName } = this.session.metadata;
    const modelConfig = appConfig.PARAM_CONFIGS[paramsKey];
    if (!modelConfig) throw createError(simpleTemplate(appState.s.e.lllm.undefinedParam, { ParamKey: paramsKey }));
    let activeConfig: ConfigModelVariant;
    switch (modelConfig.reasoningType) {
      case "reason_and_instruct":
        activeConfig = sessionType === "reasoning" ? modelConfig.reasoning : modelConfig.instruct;
        break;
      case "instruct_only":
      case "reason_only":
        activeConfig = modelConfig.default;
        break;
      default:
        throw createError(
          simpleTemplate(appState.s.e.lllm.invalidReasoningType, { Model: paramsKey, Type: String(modelConfig) }),
        );
    }
    const llmModelParams = { ...activeConfig.model };
    if (this.session.metadata.url) llmModelParams.url = this.session.metadata.url;
    return new LLM({
      chunkSize: 200000,
      batchSize: 1,
      concurrency: 1,
      apiKey: this.session.metadata.apiKey,
      ...llmModelParams,
      model: modelName ? [true, modelName] : llmModelParams.model,
    });
  }

  async saveSession(): Promise<void> {
    this.session.metadata.updatedAt = new Date().toISOString();
    const dir = path.dirname(this.sessionPath);
    await mkdir(dir, { recursive: true });
    await Bun.write(this.sessionPath, JSON.stringify(this.session, null, 2));
  }
}

class HeaderWidget extends Widget {
  constructor(private title: string) {
    super();
  }
  getStaticHeight = () => 1;
  override render(buffer: ScreenBuffer): void {
    const padding = Math.max(0, this.actualArea.width - Bun.stringWidth(this.title));
    const line = "-".repeat(padding);
    buffer.write(this.actualArea.x, this.actualArea.y, this.title + line, blue(""));
  }
}

class ChatHistoryWidget extends Widget {
  constructor(private session: ChatSession, private streamingText: string, private scrollOffset: number) {
    super();
  }
  override render(buffer: ScreenBuffer): void {
    const allLines: { text: string; fg: string | null }[] = [];
    const messages = this.session.messages.slice(1);
    for (const msg of messages) {
      const content = formatMessageContent(msg.content);
      const lines = wrapText(content, { width: this.actualArea.width - 2 });
      if (msg.role === "user") {
        allLines.push({ text: `\n> ${lines.shift() || ""}`, fg: yellowBright("") });
        allLines.push(...lines.map(l => ({ text: `  ${l}`, fg: yellowBright("") })));
      } else if (msg.role === "assistant") {
        allLines.push({ text: "", fg: null });
        allLines.push(...lines.map(l => ({ text: l, fg: null })));
      }
    }
    if (this.streamingText) {
      const streamingLines = wrapText(this.streamingText, { width: this.actualArea.width - 2 });
      allLines.push({ text: "", fg: null });
      allLines.push(...streamingLines.map(l => ({ text: l, fg: null })));
    }
    const startY = this.actualArea.y + this.actualArea.height - 1;
    let lineIdx = allLines.length - 1 - this.scrollOffset;
    for (let y = startY; y >= this.actualArea.y && lineIdx >= 0; y--) {
      const line = allLines[lineIdx--]!;
      buffer.write(this.actualArea.x, y, line.text, line.fg);
    }
  }
}

class HelpWidget extends Widget {
  constructor(private helpText: string, private controller: ChatController) {
    super();
  }
  override isFocusable = () => true;
  override render(buffer: ScreenBuffer): void {
    const area = this.actualArea;
    buffer.write(area.x, area.y, "Available Commands:", yellow(""));
    const lines = wrapText(this.helpText, { width: area.width - 2 });
    lines.forEach((line, i) => {
      if (area.y + 1 + i < area.y + area.height - 1) {
        buffer.write(area.x + 2, area.y + 1 + i, line);
      }
    });

    if (area.height > 2) {
      buffer.write(area.x, area.y + area.height - 1, appState.s.m.c.ch.pressAnyKeyToReturn, yellow(""));
    }
  }
  override handleEvent(event: any): boolean {
    if (event.type !== "keypress") return false;
    this.controller.setState(d => {
      d.mode = "chat";
      d.helpText = null;
    });
    return true;
  }
}

class BrowseWidget extends Widget {
  constructor(private controller: ChatController) {
    super();
  }
  override isFocusable = () => true;

  override render(buffer: ScreenBuffer, focusedWidget: Widget | null): void {
    super.render(buffer, focusedWidget);
    const { session, browseState } = this.controller;
    const area = this.actualArea;

    if (browseState.viewingMessageIndex !== null) {
      const msg = session.messages[browseState.viewingMessageIndex];
      if (!msg) {
        this.controller.browseExitView();
        return;
      }
      const color = msg.role === "user" ? yellowBright("") : null;
      const lines = wrapText(formatMessageContent(msg.content), { width: area.width });
      const header = simpleTemplate(appState.s.m.c.ch.viewingMessageHeader, {
        Index: browseState.viewingMessageIndex,
        Role: msg.role.toUpperCase(),
      });
      buffer.write(area.x, area.y, header, yellow(""));
      const maxVisible = Math.max(0, area.height - 2);
      const start = Math.min(Math.max(0, browseState.viewingScrollOffset), Math.max(0, lines.length - maxVisible));
      const visible = lines.slice(start, start + maxVisible);
      visible.forEach((line, i) => buffer.write(area.x, area.y + 1 + i, line, color));

      if (area.height > 1) {
        const lastLineY = area.y + area.height - 1;
        if (lines.length > maxVisible) {
          const hintTemplate = (appState.s.m.c.ch as any).viewingMessageScrollHint
            ?? "Scroll [↑↓ PgUp PgDn]. Other key to return. ({Start}-{End} of {Total})";
          const hint = simpleTemplate(hintTemplate, {
            Start: start + 1,
            End: start + visible.length,
            Total: lines.length,
          });
          buffer.write(area.x, lastLineY, hint, yellow(""));
        } else {
          buffer.write(area.x, lastLineY, appState.s.m.c.ch.pressAnyKeyToReturn, yellow(""));
        }
      }
      return;
    }

    let currentY = area.y;
    buffer.write(area.x, currentY++, appState.s.m.c.ch.browseModeHeader, yellow(""));
    buffer.write(area.x, currentY++, appState.s.m.c.ch.browseModeInstructions, null);
    buffer.write(area.x, currentY++, "-".repeat(area.width), null);

    const headerLines = currentY - area.y;
    const availableRows = area.height - headerLines;
    if (availableRows <= 0) return;

    const messages = session.messages;
    const totalMessages = Math.max(0, messages.length - 1);
    if (totalMessages === 0) return;

    const cursorIndex = Math.min(Math.max(1, browseState.cursorIndex), totalMessages);
    const maxVisible = availableRows;
    let startIndex = Math.max(1, cursorIndex - Math.floor(maxVisible / 2));
    startIndex = Math.min(startIndex, Math.max(1, totalMessages - maxVisible + 1));

    for (let i = 0; i < maxVisible; i++) {
      const msgIndex = startIndex + i;
      if (msgIndex > totalMessages) break;
      const msg = messages[msgIndex]!;
      const isCursorLine = msgIndex === cursorIndex;
      const roleColor = msg.role === "user" ? yellowBright("") : null;
      const label = `[${msgIndex}] ${msg.role.toUpperCase()}: `;
      const prefix = isCursorLine ? "> " : "  ";
      const availableWidth = Math.max(0, area.width - Bun.stringWidth(prefix) - Bun.stringWidth(label));
      let currentX = area.x;
      currentX = buffer.write(currentX, currentY, prefix, isCursorLine ? blue("") : null);
      currentX = buffer.write(currentX, currentY, label, roleColor);
      const content = formatMessageContent(msg.content, availableWidth).split("\n")[0] ?? "";
      buffer.write(currentX, currentY, content, roleColor);
      currentY++;
    }
  }

  override handleEvent(event: any): boolean {
    if (event.type !== "keypress") return false;
    const keyStr = event.key.toString();

    if (this.controller.browseState.viewingMessageIndex !== null) {
      const msg = this.controller.session.messages[this.controller.browseState.viewingMessageIndex];
      if (!msg) {
        this.controller.browseExitView();
        return true;
      }

      const lines = wrapText(formatMessageContent(msg.content), { width: this.actualArea.width });
      const maxVisible = Math.max(0, this.actualArea.height - 2);
      const maxOffset = Math.max(0, lines.length - maxVisible);
      const pageJump = Math.max(1, maxVisible);
      let handled = false;

      this.controller.setState(d => {
        const currentOffset = d.browseState.viewingScrollOffset;
        switch (keyStr) {
          case "\u001b[A": // Up
            d.browseState.viewingScrollOffset = Math.max(0, currentOffset - 1);
            handled = true;
            break;
          case "\u001b[B": // Down
            d.browseState.viewingScrollOffset = Math.min(maxOffset, currentOffset + 1);
            handled = true;
            break;
          case "\u001b[5~": // PageUp
            d.browseState.viewingScrollOffset = Math.max(0, currentOffset - pageJump);
            handled = true;
            break;
          case "\u001b[6~": // PageDown
            d.browseState.viewingScrollOffset = Math.min(maxOffset, currentOffset + pageJump);
            handled = true;
            break;
        }
      });
      if (handled) return true;

      this.controller.browseExitView();
      return true;
    }

    const pageHeight = Math.max(1, this.actualArea.height - 4);
    switch (keyStr) {
      case "\u001b[A":
        this.controller.browseMoveCursor("up", pageHeight);
        return true;
      case "\u001b[B":
        this.controller.browseMoveCursor("down", pageHeight);
        return true;
      case "\u001b[5~":
        this.controller.browseMoveCursor("pageup", pageHeight);
        return true;
      case "\u001b[6~":
        this.controller.browseMoveCursor("pagedown", pageHeight);
        return true;
      case "\r":
        this.controller.browseViewMessage();
        return true;
      case "\u007f": // Backspace
      case "\u001b[3~": // Delete key
        this.controller.deleteMessage(this.controller.browseState.cursorIndex);
        return true;
      case "\u001b":
      case "q":
        this.controller.exitBrowseMode();
        return true;
    }
    return false;
  }
}

class InputBarWidget extends Widget {
  private prompt = "> ";
  constructor(private value: string, private isContextLimitExceeded: boolean, private controller: ChatController) {
    super();
  }
  override isFocusable = () => true;
  getStaticHeight = (width: number) => wrapText(this.prompt + this.value, { width }).length || 1;

  override render(buffer: ScreenBuffer, focusedWidget: Widget | null): void {
    super.render(buffer, focusedWidget);
    const color = this.isContextLimitExceeded ? red("") : yellowBright("");
    const lines = wrapText(this.prompt + this.value, { width: this.actualArea.width });
    lines.forEach((line, i) => {
      if (this.actualArea.y + i < this.actualArea.y + this.actualArea.height) {
        buffer.write(this.actualArea.x, this.actualArea.y + i, line, color);
      }
    });
  }

  override getCursorPosition = () => {
    if (!this.isFocused) return null;
    const lines = wrapText(this.prompt + this.value, { width: this.actualArea.width });
    const lastLine = lines.at(-1) ?? "";
    return { x: Bun.stringWidth(lastLine), y: this.actualArea.y + lines.length - 1 };
  };

  override handleEvent = (event: any): boolean => {
    if (!this.isFocused || event.type !== "keypress") return false;
    const key: Buffer = event.key;
    const code = key[0]!;
    const text = key.toString();

    if (code === 13) {
      this.controller.submitInput();
      return true;
    }
    if (code === 127) {
      this.controller.setInputBuffer([...this.value].slice(0, -1).join(""));
      return true;
    }
    if (!text.startsWith("\u001b") && code >= 32) {
      this.controller.setInputBuffer(this.value + text);
      return true;
    }
    return false;
  };
}

class StatusBarWidget extends Widget {
  constructor(private controller: ChatController) {
    super();
  }
  getStaticHeight = () => 1;
  override render(buffer: ScreenBuffer): void {
    let left: string, right: string, color: string;
    if (this.controller.statusMessage) {
      color = this.controller.statusMessage.type === "error" ? red("") : blue("");
      left = ` ${this.controller.statusMessage.text}`;
      right = " ";
    } else {
      const { contextLimit } = this.controller.session.metadata;
      const totalTokens = getTotalTokens(this.controller.session);
      const usage = ((totalTokens / contextLimit) * 100).toFixed(1);
      color = yellow("");
      left = simpleTemplate(appState.s.m.c.ch.statusBarTokens, {
        Total: totalTokens,
        Limit: contextLimit,
        Usage: usage,
      });
      right = appState.s.m.c.ch.statusBarHelp;
    }
    const padding = " ".repeat(Math.max(0, this.actualArea.width - (Bun.stringWidth(left) + Bun.stringWidth(right))));
    buffer.write(this.actualArea.x, this.actualArea.y, left + padding + right, color);
  }
}

class MainAreaWidget extends Widget {
  constructor(private controller: ChatController) {
    super();
  }

  override isFocusable = (): boolean => {
    return this.controller.mode === "browse" || this.controller.mode === "help";
  };

  override handleEvent = (event: any): boolean => {
    if (super.handleEvent(event)) {
      return true;
    }

    if (event.type !== "keypress") return false;
    if (this.controller.mode === "chat") {
      const keyStr = event.key.toString();
      let scrollDirection: "up" | "down" | "pageup" | "pagedown" | null = null;
      switch (keyStr) {
        case "\u001b[A":
          scrollDirection = "up";
          break;
        case "\u001b[B":
          scrollDirection = "down";
          break;
        case "\u001b[5~":
          scrollDirection = "pageup";
          break;
        case "\u001b[6~":
          scrollDirection = "pagedown";
          break;
      }
      if (scrollDirection) {
        const totalLines = this.controller.session.messages.reduce(
          (acc, msg) =>
            acc + wrapText(formatMessageContent(msg.content), { width: this.actualArea.width - 2 }).length + 1,
          0,
        );
        return this.controller.handleScroll(scrollDirection, this.actualArea.height, totalLines);
      }
    }
    return false;
  };
}

export default class ChatCommand implements Command {
  static allowPositionals = true;
  static positionalCompletion = "file" as const;
  static helpReplacements = { DefaultModel: appConfig.DEFAULT_MODEL };
  static options = {
    "file": { type: "string", short: "i" },
    "image": { type: "string", short: "I" },
    "model": { type: "string", short: "m" },
    "params": { type: "string", short: "p", default: appConfig.DEFAULT_MODEL },
    "context-limit": { type: "string", short: "c", default: String(DEFAULT_CONTEXT_LIMIT) },
    "apikey": { type: "string", short: "k", default: appConfig.FALLBACK_VALUES.apiKey },
    "url": { type: "string", short: "u" },
    "reason": { type: "boolean", short: "r" },
    "help": { type: "boolean", short: "h" },
  } as const;

  async execute(argv: string[]): Promise<number> {
    appState = AppStateSingleton.getInstance();
    const { values: argValues, positionals } = parseArgs({
      args: argv,
      options: ChatCommand.options,
      allowPositionals: true,
      strict: true,
    });
    if (argValues["help"]) {
      this._displayHelp();
      return 0;
    }
    if (!positionals[1]) {
      this._displayHelp();
      errlog(red(appState.s.e.c.ch.chatNameMissing));
      return 1;
    }
    const chatName = positionals[1].endsWith(CHAT_FILE_EXTENSION)
      ? positionals[1].slice(0, -CHAT_FILE_EXTENSION.length)
      : positionals[1];
    const sessionPath = path.join(appState.STATE_DIR, "chats", `${chatName}${CHAT_FILE_EXTENSION}`);
    try {
      const { session, initialContent } = await this._loadOrCreateSession(sessionPath, argValues);
      const renderApp = (state: ChatController): Widget => {
        const isContextLimitExceeded = getTotalTokens(state.session) > state.session.metadata.contextLimit;
        let mainContentWidget: Widget;

        switch (state.mode) {
          case "help":
            mainContentWidget = new HelpWidget(state.helpText!, state);
            break;
          case "browse":
            mainContentWidget = new BrowseWidget(state);
            break;
          default: // 'chat'
            mainContentWidget = new ChatHistoryWidget(state.session, state.streamingAssistantText, state.scrollOffset);
            break;
        }

        const mainArea = new MainAreaWidget(state);
        mainArea.addChild(mainContentWidget);

        const children: Widget[] = [
          new HeaderWidget(`Chat: ${path.basename(state.sessionPath, CHAT_FILE_EXTENSION)}`),
          mainArea,
          new StatusBarWidget(state),
        ];

        if (state.mode === "chat") {
          children.push(new InputBarWidget(state.inputBuffer, isContextLimitExceeded, state));
        }

        return new VStack(children);
      };
      const app = new CLIApplication<ChatController>(null!, renderApp);
      const controller = new ChatController(session, sessionPath, app, initialContent);
      app.state = controller;
      await app.run();
      if (controller.hasUnsavedChanges) {
        await controller.saveSession();
      }
    } catch (err) {
      errlog(red(simpleTemplate(appState.s.e.c.ch.chatLoopError, { Error: String(err) })));
      return 1;
    } finally {
      await shutdownTokenCounter();
    }
    return 0;
  }

  private async _loadOrCreateSession(
    sessionPath: string,
    argValues: Record<string, any>,
  ): Promise<{ session: ChatSession; initialContent: { prep: string; file: string; images: string[] } }> {
    const file = Bun.file(sessionPath);
    if (await file.exists()) {
      log(blue(simpleTemplate(appState.s.m.c.ch.loadingSession, { Path: sessionPath })));
      try {
        const session = (await file.json()) as ChatSession;
        return { session, initialContent: { prep: "", file: "", images: [] } };
      } catch (e) {
        throw createError(simpleTemplate(appState.s.e.c.ch.sessionLoadError, { Path: sessionPath }), { cause: e });
      }
    }
    log(blue(simpleTemplate(appState.s.m.c.ch.creatingNewSession, { Path: sessionPath })));
    const paramsKey = argValues["params"] as string;
    const modelConfig = appConfig.PARAM_CONFIGS[paramsKey];
    if (!modelConfig) throw createError(simpleTemplate(appState.s.e.lllm.undefinedParam, { ParamKey: paramsKey }));
    let activeConfig: ConfigModelVariant;
    let sessionType: "instruct" | "reasoning";
    switch (modelConfig.reasoningType) {
      case "reason_and_instruct":
        activeConfig = argValues["reason"] ? modelConfig.reasoning : modelConfig.instruct;
        sessionType = argValues["reason"] ? "reasoning" : "instruct";
        break;
      case "instruct_only":
        activeConfig = modelConfig.default;
        sessionType = "instruct";
        if (argValues["reason"]) {
          log(yellow(simpleTemplate(appState.s.e.lllm.reasoningNotSupported, { Model: paramsKey })));
        }
        break;
      case "reason_only":
        activeConfig = modelConfig.default;
        sessionType = "reasoning";
        break;
      default:
        throw createError(
          simpleTemplate(appState.s.e.lllm.invalidReasoningType, { Model: paramsKey, Type: String(modelConfig) }),
        );
    }
    const model = argValues["model"] || activeConfig.model?.model?.[1];
    let tName = "dummy";

    if (model) {
      const lower = model.toLowerCase();
      for (const key of Object.keys(TcCommand.MODELS_TO_DOWNLOAD)) {
        if (lower.includes(key)) {
          tName = key;
          break;
        }
      }
    }
    const newSession: ChatSession = {
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        paramsKey,
        sessionType,
        modelName: model,
        tokenizerName: tName,
        contextLimit: Number(argValues["context-limit"]) || DEFAULT_CONTEXT_LIMIT,
        url: argValues["url"] ?? null,
        apiKey: argValues["apikey"] ?? null,
      },
      messages: [],
    };

    const { defSys, defPrep } = activeConfig.prompt ?? {};
    if (defSys && defSys.length > 2 && defSys.at(-1) === true) {
      const [_, text, role] = defSys;
      newSession.messages.push({
        role: role || "system",
        content: text,
        tokens: await countTokens(newSession.metadata.tokenizerName, text),
      });
    }

    let prepText = "";
    if (defPrep && defPrep.length > 1 && defPrep.at(-1) === true) {
      const [_, text] = defPrep;
      prepText = text;
    }

    let fileText = "";
    if (argValues["file"]) {
      const f = argValues["file"] as string;
      if (await Bun.file(f).exists()) {
        await validateFiles(f);
        fileText = stripGarbageNewLines(await Bun.file(f).text());
      }
    }
    const initialImages = await buildImageContent(argValues["image"] as string | undefined);

    await mkdir(path.dirname(sessionPath), { recursive: true });
    await Bun.write(sessionPath, JSON.stringify(newSession, null, 2));

    return { session: newSession, initialContent: { prep: prepText, file: fileText, images: initialImages } };
  }

  private _displayHelp(): void {
    log(
      generateHelpText(appState.s.help.commands.ch, ChatCommand.options, {
        ModelParamList: getPresetHelpText(appConfig.PARAM_CONFIGS),
        DefaultModel: appConfig.DEFAULT_MODEL,
      }),
    );
  }
}
