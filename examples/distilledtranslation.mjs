import fs from "node:fs";
// A quick conversion of the batched translation part of telocity into a one file
// JavaScript script done with Gemini 3.1 Pro as a form of documentation through code
// of the basic principles in use.
// No config file, CLI arg parsing or validation, just a top down
// execution flow and globals to change the configuration.
// ============================================================================
// CONFIGURATION & SETTINGS
// ============================================================================
// Edit these variables to shape the behavior of the translation script.
// ============================================================================

const INPUT_FILE = "./input.txt";
const OUTPUT_FILE = "./translated.txt";

// API Configuration
const API_URL = "http://localhost:8080/v1/chat/completions";
const API_KEY = ""; // Leave blank if your local endpoint doesn't require it
const MODEL_NAME = "qwen";

// Execution & Timeout constraints
const TIMEOUT_MINUTES = 1; // Hard timeout per API request (aborts if exceeded)
const CHUNK_SIZE = 10; // Number of lines per text chunk
const BATCH_SIZE = 32; // Number of chunks to process in one save loop
/* IF ON AN ONLINE API, MAKE SURE THIS IS SET TO A REASONABLE AMOUNT ALONG WITH PARALLEL
 * READ YOUR PROVIDER DOCUMENTATION. For larger, smarter models, you can dramatically increase CHUNK_SIZE instead, to give them many lines to process per request, instead of firing many small requests.
 */
const PARALLEL_REQUESTS = 4; // Number of concurrent API requests

// Retry & Temperature Progression
// -------------------------------
// Temperature controls randomness in model output.
// On retries, we start deterministic and gradually allow more exploration:
//
// TEMP_START: initial deterministic attempt (usually 0.0 for translations).
// TEMP_INCREMENT: how much to increase temperature after each retry.
// MAX_RETRIES: limits number of retries per chunk.
//
// Rationale:
// - First attempts are low-temperature for consistent, faithful translation.
// - If the model repeatedly fails (logical errors or empty responses), the
//   temperature is increased starting from Attempt 4. This helps the model
//   escape "stuck" states or repetitive decoding loops.
// - Temperature is capped at 1.0 to prevent total hallucination.
//
// Example progression (TEMP_START = 0.0, TEMP_INCREMENT = 0.15):
// Attempt 1 → 0.0  (Initial)
// Attempt 2 → 0.0  (Retry 1)
// Attempt 3 → 0.0  (Retry 2)
// Attempt 4 → 0.15 (Retry 3 - First "exploration" attempt)
// Attempt 5 → 0.30 (Retry 4)
// ...
// Capped at 1.0 for later retries
//
// Notes:
// - The code checks `if (attempt >= 3)` during the failure of the 3rd attempt,
//   meaning the 4th call is the first to see the incremented temperature.
const TEMP_START = 0.0; // Starting temperature
const TEMP_INCREMENT = 0.15; // Amount to raise temperature on retry
const MAX_RETRIES = 7; // Maximum number of attempts per chunk before failing
const RETRY_DELAY_MS = 2000;
/*
 * MINIMUM DELAY (ms) before retrying a failed request.
 *
 * Retries use exponential backoff with jitter:
 *
 *   baseDelay = 2^attempt * 5000
 *   jitter    = random 0–1000 ms
 *   waitTime  = min(60_000, max(MIN_DELAY, baseDelay + jitter))
 *
 * This means:
 * - Delay grows significantly with each retry.
 * - Max delay is capped at 1 minute (60,000 ms).
 * - Jitter prevents "thundering herd" issues where multiple parallel
 *   requests retry at the exact same millisecond.
 *
 * Example progression (RETRY_DELAY_MS = 2000):
 * After Attempt 1 fails → ~10s - 11s  (2^1 * 5000)
 * After Attempt 2 fails → ~20s - 21s  (2^2 * 5000)
 * After Attempt 3 fails → ~40s - 41s  (2^3 * 5000)
 * After Attempt 4 fails → ~60s        (Capped at 60s)
 *
 * =====================================================================
 * ⚠️  IMPORTANT — IF YOU ARE USING A PAID / ONLINE API:
 * =====================================================================
 * The current base multiplier (5000) is quite aggressive for long waits.
 * If you want faster retries, lower the 5000 in the code to 1000 or 2000.
 * =====================================================================
 */

// Prompt Configuration
const TARGET_LANGUAGE = "英语"; // "English" written in Simplified Chinese
const SYSTEM_PROMPT = ""; // Leave empty string if not needed
const PREFILL = ""; // e.g., "<think>something something" to forcefully induce behavior

// -----------------------------
// Prompt repetition / doubling: https://arxiv.org/abs/2512.14982
// -----------------------------
// Prompt Repetition: repeat the entire user query (e.g. "<QUERY><QUERY>").
//
// Rationale (empirical / experimental):
// - Repeating the prompt lets prompt tokens attend to each other in a
//   causal LM prefill stage, which mitigates ordering effects (e.g.
//   options-first vs question-first) and improves instruction adherence
//   on a wide set of non-reasoning tasks. See the experiments in the
//   referenced paper for broad model/benchmark wins.
//
// Practical effects & tradeoffs:
// - Does NOT increase generated output length or latency in practice,
//   because the repetition affects the parallelizable prefill stage
//   rather than the generation stage (so wall-time is similar).
// - However, the input prefill token count is larger (you are sending
//   more prompt tokens). This can affect token-based billing or hit
//   input-length limits on some providers — be mindful of very long
//   prompts.
// - Variants exist (verbose, ×3, partial repetition) that can further
//   help some tasks; empirically repeat×2 and repeat×3 are often good.
// - Best suited for tasks where you are not explicitly asking the LLM
//   to perform chain-of-thought reasoning. When you are enabling
//   step-by-step thinking, repetition is usually neutral to slightly
//   positive. By nature, reasoners will repeat much of the content
//   in their <think> blocks so they already experience the benefits
//   without prompt doubling.
//
// Implementation note:
// - We duplicate the instruction and the injected text to encourage the
//   model to align to the translation instruction across the prefill.
//   Why this helps for translation:
//   - When the model encounters the repeated (later) copy of the text,
//     that second pass reinforces and refines how the model represents
//     the same content. Practically, the later appearance of the text
//     strengthens contextual signals the model uses to interpret the
//     earlier tokens, which improves fidelity to the translation
//     instruction.
// Also, for many (not all, it's not really a science) smaller models,
// write your translation prompt in the language of the source
// you want to translate. For e.g, here in Simplified Chinese:
const USER_PROMPT_TEMPLATE = `将以下文本翻译为{{ .LanguageTarget }}，注意只需要输出翻译后的结果，不要额外解释：\n\n{{ .TextToInject }}\n\n将以下文本翻译为{{ .LanguageTarget }}，注意只需要输出翻译后的结果，不要额外解释：\n\n{{ .TextToInject }}`;

// a similar prompt in English:
// const USER_PROMPT_TEMPLATE = `Translate the following text into {{ .LanguageTarget }}. Output only the translated result and do not add any extra explanation:\n\n{{ .TextToInject }}\n\nTranslate the following text into {{ .LanguageTarget }}. Output only the translated result and do not add any extra explanation:\n\n{{ .TextToInject }}`;

// Raw Payload Variables
// Add or tweak any raw parameters you want sent directly to the LLM backend here.
// Make sure you follow what your backend supports.
const EXTRA_PAYLOAD_ARGS = {
  top_k: 20,
  top_p: 0.8,
  presence_penalty: 1.5,
  // chat_template_kwargs: { enable_thinking: false }, // uncomment to disable reasoning in Qwen+llama.cpp
};

// ============================================================================
// INTERNAL LOGIC (You shouldn't need to edit below this line)
// ============================================================================

const STATE_FILE = `${OUTPUT_FILE}.state.json`;

// --- 1. Utility Functions ---

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeNewlines(text) {
  // Preserves only pure LF (\n). Never allow other line endings to make it to your LLM.
  return text.replace(/\r\n|\r/g, "\n").replace(/\u2028|\u2029/g, "");
}

function segmentText(text, chunkSize) {
  const lines = text.split("\n");
  const chunks = [];
  for (let i = 0; i < Math.ceil(lines.length / chunkSize); i++) {
    const start = i * chunkSize;
    chunks.push(lines.slice(start, start + chunkSize).join("\n"));
  }
  return chunks;
}

// A simple concurrency limiter mapping tasks to promises
async function runConcurrent(tasks, limit) {
  const results = [];
  let currentIndex = 0;

  const worker = async () => {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      results[index] = await tasks[index]();
    }
  };

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

// --- 2. API Communication Logic ---

function determineBackendType(url) {
  if (url.endsWith("/responses")) return "responses";
  if (url.endsWith("/completions") && !url.endsWith("/chat/completions"))
    return "completions";
  return "chat_completions";
}

function buildPayload(textChunk, currentTemp, backendType) {
  const userContent = USER_PROMPT_TEMPLATE.replace(
    /\{\{\s*\.LanguageTarget\s*\}\}/g,
    TARGET_LANGUAGE,
  ).replace(/\{\{\s*\.TextToInject\s*\}\}/g, textChunk);

  const basePayload = {
    model: MODEL_NAME,
    temperature: currentTemp,
    stream: true,
    ...EXTRA_PAYLOAD_ARGS,
  };

  if (backendType === "completions") {
    return { ...basePayload, prompt: userContent };
  }

  if (backendType === "responses") {
    let instructions = SYSTEM_PROMPT || undefined;
    return {
      ...basePayload,
      instructions,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: userContent }],
        },
      ],
    };
  }

  // Default: chat_completions
  const messages = [];
  if (SYSTEM_PROMPT) messages.push({ role: "system", content: SYSTEM_PROMPT });
  messages.push({ role: "user", content: userContent });
  if (PREFILL) messages.push({ role: "assistant", content: PREFILL });

  return { ...basePayload, messages };
}

function extractStreamedText(chunk, backendType) {
  if (backendType === "responses") {
    if (chunk.type === "response.output_text.delta" && chunk.delta)
      return chunk.delta;
    if (chunk.choices?.[0]?.delta?.content)
      return chunk.choices[0].delta.content;
    return "";
  }
  if (backendType === "completions") {
    return chunk.choices?.[0]?.text || "";
  }
  // Default: chat_completions
  return chunk.choices?.[0]?.delta?.content || "";
}

async function callLLMWithRetry(chunk, attempt, temp, backendType) {
  const controller = new AbortController();
  const timeoutMs = TIMEOUT_MINUTES * 60 * 1000;

  // Hard timeout timer
  const timeoutId = setTimeout(() => {
    controller.abort(
      new Error(`Hard timeout of ${TIMEOUT_MINUTES} minutes exceeded.`),
    );
  }, timeoutMs);

  try {
    const payload = buildPayload(chunk, temp, backendType);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    if (!response.body) {
      throw new Error("Received empty response body from API.");
    }

    // --- Server-Sent Events (SSE) Streaming Parser ---
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let doneSignalReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

        let eventEndIndex;
        while ((eventEndIndex = buffer.indexOf("\n\n")) >= 0) {
          const eventPart = buffer.slice(0, eventEndIndex);
          buffer = buffer.slice(eventEndIndex + 2);

          if (!eventPart.trim()) continue;

          const lines = eventPart.split("\n");
          let dataStr = "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith("data:")) {
              dataStr += (dataStr ? "\n" : "") + trimmed.substring(5).trim();
            }
          }

          if (!dataStr) continue;
          if (dataStr === "[DONE]") {
            doneSignalReceived = true;
            break;
          }

          try {
            const parsed = JSON.parse(dataStr);
            fullText += extractStreamedText(parsed, backendType);
          } catch {
            // Safely ignore malformed JSON or partial chunks
          }
        }

        if (doneSignalReceived) break;
      }
    } finally {
      reader.releaseLock();
    }

    if (!fullText.trim())
      throw new Error("Received empty text output from the model.");
    return fullText;
  } catch (error) {
    if (attempt >= MAX_RETRIES) {
      console.error(
        `Failed processing chunk after ${MAX_RETRIES} attempts. Last error: ${error.message}`,
      );
      throw error;
    }

    let nextTemp = temp;
    if (attempt >= 3) {
      nextTemp = Math.min(1.0, +(temp + TEMP_INCREMENT).toFixed(2));
    }

    const baseDelay = Math.pow(2, attempt) * 5000;
    const jitter = Math.random() * 1000;
    const waitTime = Math.min(
      60000,
      Math.max(RETRY_DELAY_MS, baseDelay + jitter),
    );

    console.warn(
      `Attempt ${attempt} failed (${error.message}). Retrying in ${waitTime}ms with Temp ${nextTemp}...`,
    );
    await delay(waitTime);

    return callLLMWithRetry(chunk, attempt + 1, nextTemp, backendType);
  } finally {
    clearTimeout(timeoutId);
  }
}

// --- 3. Main State and Execution Loop ---

async function main() {
  console.log("Starting LLM Translation Script...");

  // 1. Read and Normalize Input
  if (!fs.existsSync(INPUT_FILE)) {
    console.error(`Input file not found: ${INPUT_FILE}`);
    process.exit(1);
  }

  const rawText = fs.readFileSync(INPUT_FILE, "utf-8");
  const normalizedText = normalizeNewlines(rawText);
  const chunks = segmentText(normalizedText, CHUNK_SIZE);

  console.log(`Total chunks to process: ${chunks.length}`);

  // 2. Load Progress State
  let lastIndex = 0;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      lastIndex = state.lastIndex || 0;
      console.log(`Resuming from saved progress at chunk index: ${lastIndex}`);
    } catch {
      console.warn("Failed to read state file, starting from the beginning.");
    }
  }

  // 3. Process Batches
  const backendType = determineBackendType(API_URL);
  console.log(
    `Detected backend type: ${backendType} | Hard Timeout: ${TIMEOUT_MINUTES} min`,
  );

  while (lastIndex < chunks.length) {
    const batchStartTime = Date.now();
    const currentBatch = chunks.slice(lastIndex, lastIndex + BATCH_SIZE);
    const batchEndIndex = lastIndex + currentBatch.length;

    console.log(`Processing chunks ${lastIndex + 1} to ${batchEndIndex}...`);

    // Create tasks for the concurrent worker
    const tasks = currentBatch.map((chunk) => {
      return () => callLLMWithRetry(chunk, 1, TEMP_START, backendType);
    });

    // Run the batch utilizing our parallel request limit
    const results = await runConcurrent(tasks, PARALLEL_REQUESTS);

    // Append results safely, formatting cleanly with LF
    const formattedOutput =
      results.map(normalizeNewlines).join("\n\n") + "\n\n";
    fs.appendFileSync(OUTPUT_FILE, formattedOutput, "utf-8");

    // Advance index and save state
    lastIndex = batchEndIndex;
    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify({ lastIndex }, null, 2),
      "utf-8",
    );

    console.log(
      `Progress saved. (${lastIndex} / ${chunks.length} chunks done)`,
    );
    if (lastIndex < chunks.length) {
      const elapsed = Date.now() - batchStartTime;
      const remainingDelay = Math.max(RETRY_DELAY_MS - elapsed, 0);

      if (remainingDelay > 0) {
        await delay(remainingDelay);
      }
    }
  }

  // 4. Cleanup
  if (fs.existsSync(STATE_FILE)) {
    fs.unlinkSync(STATE_FILE);
  }

  console.log("Translation completed successfully!");
}

// Execute Script
main().catch((err) => {
  console.error("Unhandled Fatal Error:", err);
  process.exit(1);
});
