import fs from "node:fs/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";
import {
  config as appConfig,
  AppStateSingleton,
} from "../../src/libs/core/index.ts";
import type { ConfigModelVariant } from "../../src/libs/types/index.ts";
import { main } from "../../src/main.ts";
import {
  cleanupProgressEntryForSource,
  initTest,
  setupTestEnvironment,
  SOURCE_FILE,
  teardownTestEnvironment,
  TestEnvironment,
  withCapturedConsole,
} from "../testutils.ts";

await initTest();

const TEST_PARAMS_KEY = "qwen";
const modelConfig = appConfig.PARAM_CONFIGS[TEST_PARAMS_KEY];

if (!modelConfig) {
  throw new Error(
    `Model preset '${TEST_PARAMS_KEY}' not found in PARAM_CONFIGS. Check your test configuration.`,
  );
}

let activeConfig: ConfigModelVariant;
switch (modelConfig.reasoningType) {
  case "reason_and_instruct":
    activeConfig = modelConfig.instruct;
    break;
  case "instruct_only":
    activeConfig = modelConfig.default;
    break;
  case "reason_only":
    activeConfig = modelConfig.default;
    break;
  default: {
    const _exhaustiveCheck: never = modelConfig;
    throw new Error(
      `Unhandled reasoning type in test setup: ${
        (_exhaustiveCheck as { reasoningType: string })?.reasoningType
      }`,
    );
  }
}

describe("Translate Command (Default Args)", () => {
  let testEnv: TestEnvironment;
  let appState;

  beforeAll(async () => {
    testEnv = await setupTestEnvironment();
    appState = AppStateSingleton.getInstance();
    Object.defineProperty(appState, "DEBUG_MODE", {
      value: true,
      writable: true,
      configurable: true,
    });
  });

  afterAll(async () => {
    await teardownTestEnvironment(testEnv);
  });

  beforeEach(async () => {
    process.env["LC_ALL"] = "en_US.UTF-8";
    process.env["LANG"] = "en_US.UTF-8";
    await fs.rm(testEnv.targetFile, { force: true });
  });

  afterEach(async () => {
    await cleanupProgressEntryForSource();
  });

  test("handles default arguments correctly (prioritizing Model Config over Fallback)", async () => {
    const args = [
      "tr",
      SOURCE_FILE,
      testEnv.targetFile,
      "--debug",
      "--wait",
      "0.005",
      "--params",
      TEST_PARAMS_KEY,
    ];

    const output = await withCapturedConsole(async () => {
      await main(args, false);
    });

    const expectedUrl = activeConfig.model.url ?? appConfig.FALLBACK_VALUES.url;

    const expectedChunkSize =
      activeConfig.model.chunkSize !== undefined
        ? activeConfig.model.chunkSize
        : +appConfig.FALLBACK_VALUES.chunkSize;

    const expectedBatchSize =
      activeConfig.model.batchSize !== undefined
        ? activeConfig.model.batchSize
        : +appConfig.FALLBACK_VALUES.batchSize;

    [
      "中南大学人文学院的胡游研究认为",
      `chunkSize":${expectedChunkSize}`,
      `batchSize":${expectedBatchSize}`,
      `url":"${expectedUrl}`,
    ].forEach((expected) => expect(output).toContain(expected));
  });
});
