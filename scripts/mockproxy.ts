import * as http from "http";
import { IncomingMessage, ServerResponse } from "http";
import * as stream from "stream";

const PROXY_PORT: number = 8080;
const TARGET_HOST: string = "localhost";
const TARGET_PORT: number = 8081;

function requestHandler(req: IncomingMessage, res: ServerResponse) {
  console.log(`[PROXY] Received request: ${req.method} ${req.url}`);
  console.log("[PROXY] Request Headers:", req.headers);

  const options: http.RequestOptions = {
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    console.log(
      `[PROXY] Received response from target: ${proxyRes.statusCode}`,
    );
    console.log("[PROXY] Response Headers from target:", proxyRes.headers);

    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error("[PROXY] Error forwarding request:", err);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Bad Gateway", details: err.message }));
  });

  const requestBodyTee = new stream.PassThrough();
  const chunks: Buffer[] = [];

  requestBodyTee.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  requestBodyTee.on("end", () => {
    const requestBody = Buffer.concat(chunks).toString("utf-8");
    console.log("[PROXY] Request Body:", requestBody);
  });

  req.pipe(requestBodyTee).pipe(proxyReq);

  req.on("error", (err) => {
    console.error("[PROXY] Error with incoming request:", err);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ error: "Internal Server Error", details: err.message }),
    );
  });
}

const server = http.createServer(requestHandler);

server.listen(PROXY_PORT, () => {
  console.log(
    "================================================================",
  );
  console.log(`  Proxy is running on http://localhost:${PROXY_PORT}`);
  console.log(`  Forwarding requests to http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log(
    "================================================================",
  );
});
