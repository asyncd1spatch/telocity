#!/usr/bin/env bun

import * as http from "http";
import { IncomingMessage, ServerResponse } from "http";

const PORT: number = 8080;

function handleChatCompletions(res: ServerResponse, isStream: boolean) {
  if (isStream) {
    sendStream(res, [
      { choices: [{ delta: { content: "Mock " } }] },
      { choices: [{ delta: { content: "chat " } }] },
      { choices: [{ delta: { content: "completion " } }] },
      { choices: [{ delta: { content: "stream." } }] },
    ]);
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [
          { message: { content: "Mock chat completion batch response." } },
        ],
      }),
    );
  }
}

function handleResponses(res: ServerResponse, isStream: boolean) {
  if (isStream) {
    sendStream(res, [
      { type: "response.output_text.delta", delta: "Mock " },
      { type: "response.output_text.delta", delta: "responses " },
      { type: "response.output_text.delta", delta: "stream." },
      { type: "response.output_text.done", text: "Mock responses stream." },
    ]);
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "Mock responses batch response." },
            ],
          },
        ],
      }),
    );
  }
}

function handleCompletions(res: ServerResponse, isStream: boolean) {
  if (isStream) {
    sendStream(res, [
      { choices: [{ text: "Mock " }] },
      { choices: [{ text: "legacy " }] },
      { choices: [{ text: "completions " }] },
      { choices: [{ text: "stream." }] },
    ]);
  } else {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ text: "Mock legacy completions batch response." }],
      }),
    );
  }
}

function sendStream(res: ServerResponse, chunks: unknown[]) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  let delay = 0;
  for (const chunk of chunks) {
    setTimeout(() => {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }, delay);
    delay += 50;
  }

  setTimeout(() => {
    res.write("data: [DONE]\n\n");
    res.end();
  }, delay);
}

function requestHandler(req: IncomingMessage, res: ServerResponse) {
  console.log(
    "\n================================================================",
  );
  console.log(
    `[MOCK] Received request: ${req.method ?? "UNKNOWN"} ${req.url ?? ""}`,
  );
  console.log("[MOCK] Request Headers:", req.headers);

  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf-8");
  });

  req.on("end", () => {
    console.log("[MOCK] Request Body:", body);

    let payload: Record<string, unknown> = {};
    if (body) {
      try {
        payload = JSON.parse(body) as Record<string, unknown>;
      } catch {
        console.error("[MOCK] Warning: Could not parse request body as JSON.");
      }
    }

    const isStream = payload["stream"] === true;
    const url = req.url ?? "";

    if (url.includes("/v1/chat/completions")) {
      console.log(
        `[MOCK] Routing to Chat Completions (Stream: ${String(isStream)})`,
      );
      handleChatCompletions(res, isStream);
    } else if (url.includes("/v1/responses")) {
      console.log(`[MOCK] Routing to Responses (Stream: ${String(isStream)})`);
      handleResponses(res, isStream);
    } else if (url.includes("/v1/completions")) {
      console.log(
        `[MOCK] Routing to Legacy Completions (Stream: ${String(isStream)})`,
      );
      handleCompletions(res, isStream);
    } else {
      console.log(`[MOCK] Unknown endpoint requested: ${url}`);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Endpoint not mocked." }));
    }
  });

  req.on("error", (err: Error) => {
    console.error("[MOCK] Error with incoming request:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Internal Server Error", details: err.message }),
    );
  });
}

const server = http.createServer(requestHandler);

server.listen(PORT, () => {
  console.log(
    "================================================================",
  );
  console.log(`  Mock Server is running on http://localhost:${PORT}`);
  console.log(`  Supporting endpoints:`);
  console.log(`   - /v1/chat/completions`);
  console.log(`   - /v1/responses`);
  console.log(`   - /v1/completions`);
  console.log(
    "================================================================",
  );
});
