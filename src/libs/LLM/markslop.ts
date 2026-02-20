// this file is pure vibes and is incorrect in many ways.
// just a quick convenience since LLMs are so overtrained to
// output markslop their performance can drop when told not to.
// I can't be arsed to do it right, I hate markdown.
// Parsing markdown in a streaming manner is the road to hell
// and a vibecoded version that doesn't do real time streaming
// but some buffering is all I can bear with.
// this is a pure CLI style tool and not a TUI, so rewritting
// previously output content is not allowed.
// ANSI style color codes weren't as braindeadly done as markslop.
import {
  blue,
  bold,
  compose,
  dim,
  italic,
  strikethrough,
  stringWidth,
  underline,
  yellow,
  yellowBright,
} from "../core/index.ts";

type MarkdownRenderFn = (text: string) => string;

interface BaseToken {
  type: string;
  raw: string;
  text?: string;
  tokens?: BaseToken[];
  href?: string;
  depth?: number;
  items?: { tokens: BaseToken[] }[];
  header?: TableCell[];
  rows?: TableCell[][];
}

interface TableCell {
  text: string;
  tokens: BaseToken[];
  header: boolean;
}

const ansiTheme = {
  heading: (text: string, level: number) =>
    `\n${compose(bold, underline, yellowBright)(`${"#".repeat(level)} ${text}`)}\n`,
  paragraph: (text: string) => `${text}\n`,
  blockquote: (text: string) => `${compose(dim, italic)(`▎ ${text}`)}\n`,
  code: (text: string) => `${dim(text)}\n`,
  listItem: (text: string) => `• ${text}\n`,
  list: (text: string) => `${text}`,
  table: (text: string) => `${text}\n`,
  tr: (text: string) => `${text}\n`,
  th: (text: string) => bold(`| ${text} `),
  td: (text: string) => `| ${text} `,
  strong: bold,
  emphasis: italic,
  strikethrough,
  codespan: yellow,
  link: (text: string, _href: string) => compose(underline, blue)(text),
  image: (text: string, _src: string) => dim(`[Image: ${text}]`),
  hr: () => `${dim("-".repeat(20))}\n`,
};

let renderImpl: MarkdownRenderFn | undefined;

function createBunRenderer(): MarkdownRenderFn {
  const visualPad = (text: string, width: number) => {
    const currentWidth = stringWidth(text);
    const paddingNeeded = Math.max(0, width - currentWidth);
    return text + " ".repeat(paddingNeeded);
  };

  return (text: string) => {
    const nbSpaceNormalizedText = text.replace(/^ +/gm, (spaces) =>
      "\u00A0".repeat(spaces.length),
    );

    return Bun.markdown.render(nbSpaceNormalizedText, {
      heading: (children: string, { level }: { level: number }) =>
        ansiTheme.heading(children, level),
      paragraph: ansiTheme.paragraph,
      blockquote: ansiTheme.blockquote,
      code: ansiTheme.code,
      listItem: ansiTheme.listItem,
      list: ansiTheme.list,
      table: (children: string) => {
        const rows = children
          .split("%%R%%")
          .filter(Boolean)
          .map((row) => row.split("%%C%%").filter(Boolean));

        if (rows.length === 0) return "";

        const numCols = Math.max(...rows.map((r) => r.length), 0);
        const colWidths: number[] = new Array<number>(numCols).fill(0);

        for (const row of rows) {
          for (let i = 0; i < numCols; i++) {
            const cellRaw = row[i] ?? "";
            const content = cellRaw.replace(/^%%[HD]%%/, "");
            colWidths[i] = Math.max(colWidths[i] ?? 0, stringWidth(content));
          }
        }

        const formatted = rows
          .map((row, rowIndex) => {
            const line =
              row
                .map((cellRaw, i) => {
                  const isHeader = cellRaw.startsWith("%%H%%");
                  const content = cellRaw.replace(/^%%[HD]%%/, "");
                  const padded = visualPad(content, colWidths[i] ?? 0);
                  return isHeader ? ansiTheme.th(padded) : ansiTheme.td(padded);
                })
                .join("") + "|";

            return rowIndex === 0 ? line : ansiTheme.tr(line).trimEnd();
          })
          .join("\n");

        return ansiTheme.table(formatted);
      },
      tr: (children: string) => `${children}%%R%%`,
      th: (children: string) => `%%H%%${children}%%C%%`,
      td: (children: string) => `%%D%%${children}%%C%%`,
      strong: ansiTheme.strong,
      emphasis: ansiTheme.emphasis,
      strikethrough: ansiTheme.strikethrough,
      codespan: ansiTheme.codespan,
      link: (children: string, { href }: { href: string }) =>
        ansiTheme.link(children, href),
      image: (children: string, { src }: { src: string }) =>
        ansiTheme.image(children, src),
      hr: ansiTheme.hr,
    });
  };
}

async function createMarkedRenderer(): Promise<MarkdownRenderFn> {
  const { Marked } = await import("marked");

  const resolve = (
    token: BaseToken | BaseToken[] | undefined | null,
  ): string => {
    if (!token) return "";
    if (Array.isArray(token)) return token.map(resolve).join("");
    if (token.tokens) return token.tokens.map(resolve).join("");
    return token.text ?? token.raw ?? "";
  };

  const markedInstance = new Marked();

  const renderer = {
    heading: (token: BaseToken) =>
      ansiTheme.heading(resolve(token.tokens), token.depth ?? 1),
    paragraph: (token: BaseToken) => ansiTheme.paragraph(resolve(token.tokens)),
    blockquote: (token: BaseToken) =>
      ansiTheme.blockquote(resolve(token.tokens)),
    code: (token: BaseToken) => ansiTheme.code(token.text ?? ""),
    list: (token: BaseToken) =>
      ansiTheme.list(
        (token.items ?? [])
          .map((item) => ansiTheme.listItem(resolve(item.tokens)))
          .join(""),
      ),
    table(token: BaseToken) {
      const header = token.header ?? [];
      const rows = token.rows ?? [];

      const numCols = header.length;
      const colWidths: number[] = new Array<number>(numCols).fill(0);

      const getCellText = (cell: TableCell) => resolve(cell.tokens);

      const allRows = [header, ...rows];
      for (const row of allRows) {
        for (let i = 0; i < numCols; i++) {
          const cell = row[i];
          if (cell) {
            const currentMax = colWidths[i] ?? 0;
            colWidths[i] = Math.max(currentMax, stringWidth(getCellText(cell)));
          }
        }
      }

      const visualPad = (text: string, width: number) => {
        const currentWidth = stringWidth(text);
        const paddingNeeded = Math.max(0, width - currentWidth);
        return text + " ".repeat(paddingNeeded);
      };

      const headerOutput =
        header
          .map((cell, i) =>
            ansiTheme.th(visualPad(getCellText(cell), colWidths[i] ?? 0)),
          )
          .join("") + "|";

      const bodyOutput = rows
        .map((row) =>
          ansiTheme.tr(
            row
              .map((cell, i) =>
                ansiTheme.td(visualPad(getCellText(cell), colWidths[i] ?? 0)),
              )
              .join("") + "|",
          ),
        )
        .join("");

      return ansiTheme.table(`${headerOutput}\n${bodyOutput}`);
    },
    strong: (token: BaseToken) => ansiTheme.strong(resolve(token.tokens)),
    em: (token: BaseToken) => ansiTheme.emphasis(resolve(token.tokens)),
    del: (token: BaseToken) => ansiTheme.strikethrough(resolve(token.tokens)),
    codespan: (token: BaseToken) => ansiTheme.codespan(token.text ?? ""),
    link: (token: BaseToken) =>
      ansiTheme.link(resolve(token.tokens), token.href ?? ""),
    image: (token: BaseToken) =>
      ansiTheme.image(token.text ?? "", token.href ?? ""),
    hr: () => ansiTheme.hr(),
    br: () => "\n",
    listitem: () => "",
    tablerow: () => "",
    tablecell: () => "",
  };

  markedInstance.use({ renderer: renderer as unknown as object });

  return (text: string) => {
    const vibesText = text.replace(/^ +/gm, (spaces) =>
      "\u00A0".repeat(spaces.length),
    );
    const result = markedInstance.parse(vibesText) as string;
    return result.replace(/\n\n$/, "\n");
  };
}

async function getRenderer(): Promise<MarkdownRenderFn> {
  if (renderImpl) return renderImpl;

  if (typeof Bun !== "undefined") {
    renderImpl = createBunRenderer();
  } else {
    renderImpl = await createMarkedRenderer();
  }

  return renderImpl;
}

export async function renderMarkdownToAnsi(text: string): Promise<string> {
  const renderer = await getRenderer();
  return renderer(text);
}

export function createMarkdownBuffer() {
  let outputBuffer = "";
  let inCodeBlock = false;
  let codeFenceChar: "`" | "~" | null = null;
  let codeFenceLength = 0;
  let inTable = false;

  const fenceStartRegex = /^(\s*)(`{3,}|~{3,})(.*)$/;
  const listStartRegex = /^\s*([-+*]|\d+\.)\s+/;
  const blockquoteRegex = /^\s*>/;
  const hrRegex = /^(\s*)(\*{3,}|-{3,}|_{3,})\s*$/;
  const setextRegex = /^(\s*)(-{3,}|={3,})\s*$/;

  return {
    async process(chunk: string): Promise<string> {
      outputBuffer += chunk;
      const lines = outputBuffer.split("\n");
      let renderedOutput = "";

      if (lines.length > 1) {
        let flushIndex = -1;

        for (let i = 0; i < lines.length - 1; i++) {
          const raw = lines[i] ?? "";
          const trimmed = raw.trim();

          if (!inCodeBlock) {
            const fenceMatch = raw.match(fenceStartRegex);
            if (fenceMatch) {
              inCodeBlock = true;
              const fenceStr = fenceMatch[2] ?? "";
              codeFenceChar = fenceStr[0] as "`" | "~";
              codeFenceLength = fenceStr.length;
              if (i > 0) flushIndex = Math.max(flushIndex, i - 1);
              continue;
            }

            const isTableLine = /^\s*\|/.test(raw);
            if (isTableLine) {
              inTable = true;
            } else if (inTable && trimmed === "") {
              inTable = false;
            }

            if (!inTable) {
              if (trimmed === "") {
                flushIndex = Math.max(flushIndex, i);
              } else if (/^\s*#/.test(raw)) {
                if (i > 0) flushIndex = Math.max(flushIndex, i - 1);
              } else if (
                blockquoteRegex.test(raw) ||
                listStartRegex.test(raw)
              ) {
                if (i > 0) flushIndex = Math.max(flushIndex, i - 1);
              } else if (hrRegex.test(raw)) {
                flushIndex = Math.max(flushIndex, i);
              } else if (setextRegex.test(raw)) {
                const prevLine = (lines[i - 1] ?? "").trim();
                if (i > 0 && prevLine !== "") {
                  flushIndex = Math.max(flushIndex, i);
                }
              }
            }
          } else {
            if (codeFenceChar) {
              const closingFenceRe = new RegExp(
                `^\\s*(${codeFenceChar}{${codeFenceLength},})`,
              );
              if (closingFenceRe.test(trimmed)) {
                flushIndex = Math.max(flushIndex, i);
                inCodeBlock = false;
                codeFenceChar = null;
                codeFenceLength = 0;
              }
            } else {
              inCodeBlock = false;
              codeFenceChar = null;
              codeFenceLength = 0;
            }
          }
        }

        if (flushIndex !== -1) {
          const toRender = lines.slice(0, flushIndex + 1).join("\n");
          outputBuffer = lines.slice(flushIndex + 1).join("\n");
          const renderInput = toRender + "\n";
          renderedOutput = await renderMarkdownToAnsi(renderInput);
        }
      }

      return renderedOutput;
    },

    async flush(): Promise<string> {
      if (outputBuffer.length > 0) {
        const remaining = outputBuffer;
        outputBuffer = "";
        inCodeBlock = false;
        codeFenceChar = null;
        codeFenceLength = 0;
        inTable = false;
        return await renderMarkdownToAnsi(remaining);
      }
      return "";
    },
  };
}
