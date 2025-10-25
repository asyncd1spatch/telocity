import { beforeAll, describe, expect, test } from "bun:test";
import { AppStateSingleton, createError, customParseArgs, generateHelpText } from "../src/libs/core";
import type { AppState } from "../src/libs/types";

type MockGenericHelpSection = {
  header: string;
  usage: string;
  commandHeader: string;
  commandDescriptions: Record<string, string>;
  footer: string;
  globalOptionsHeader: string;
  flags: Record<string, string>;
};

type MockHelpSection = {
  usage: string;
  description: string;
  flags: Record<string, string>;
  footer: string;
};

type MockOptionsConfig = Record<
  string,
  { type: "boolean" | "string"; short?: string }
>;

interface CodedError extends Error {
  code?: string;
}

describe("meta functions", () => {
  beforeAll(async () => {
    AppStateSingleton.init(false);
  });
  test("createError generates an error with message, code, and cause", () => {
    const causeError = new Error("Original cause");
    const newError: CodedError = createError("A new error occurred", {
      code: "TEST_CODE",
      cause: causeError,
    });

    expect(newError).toBeInstanceOf(Error);
    expect(newError.message).toBe("A new error occurred");
    expect(newError.code).toBe("TEST_CODE");
    expect(newError.cause).toBe(causeError);
  });

  test("generateHelpText formats global help correctly", () => {
    const mockGenericHelpSection: MockGenericHelpSection = {
      header: "My Awesome CLI v1.0",
      usage: "Usage: my-cli <command> [options]",
      commandHeader: "Available Commands:",
      commandDescriptions: {
        hello: "Prints a greeting.",
        goodbye: "Says farewell.",
      },
      footer: "For more information, run 'my-cli <command> --help'",
      globalOptionsHeader: "Global Options:",
      flags: {
        help: "Show help information.",
        version: "Show version number.",
      },
    };

    const helpText = generateHelpText(mockGenericHelpSection);

    expect(helpText).toInclude(mockGenericHelpSection.header);
    expect(helpText).toInclude(mockGenericHelpSection.usage);
    expect(helpText).toInclude(mockGenericHelpSection.commandHeader);
    expect(helpText).toInclude(mockGenericHelpSection.globalOptionsHeader);
    expect(helpText).toInclude(mockGenericHelpSection.footer);

    const expectedCommand = `  hello${" ".repeat(6)}Prints a greeting.`;
    const expectedFlag = `  --help${" ".repeat(5)}Show help information.`;

    expect(helpText).toInclude(expectedCommand);
    expect(helpText).toInclude(expectedFlag);
  });

  test("generateHelpText formats help output correctly", () => {
    const mockHelpSection: MockHelpSection = {
      usage: "Usage: {{ .AppName }} my-command [options]",
      description: "This is a test command.",
      flags: {
        "my-flag": "Description for my flag.",
        "another-flag": "Description for another flag.",
      },
      footer: "Find more help at {{ .HelpUrl }}",
    };
    const mockOptionsConfig: MockOptionsConfig = {
      "my-flag": { type: "boolean", short: "m" },
      "another-flag": { type: "string" },
    };
    const replacements: Record<string, string> = {
      AppName: "test-app",
      HelpUrl: "example.com",
    };

    const helpText = generateHelpText(
      mockHelpSection,
      mockOptionsConfig,
      replacements,
    );

    expect(helpText).toInclude("Usage: test-app my-command [options]");
    expect(helpText).toInclude("Find more help at example.com");
    expect(helpText).toInclude("-m, --my-flag");
    expect(helpText).toInclude("--another-flag <value>");
    expect(helpText).toInclude("Description for my flag.");
  });
});

describe("i18n-aware argument parsing", () => {
  let appState: AppState;
  beforeAll(async () => {
    appState = await AppStateSingleton.init(false);
  });
  const mockOptions = {
    name: { type: "string", short: "n" },
    verbose: { type: "boolean", short: "v" },
  } as const;

  test("customParseArgs throws a translated error for unknown options", () => {
    const argv = ["--unknown-flag"];

    const expectedError = appState.s.e.lcli.unknownOption.replace(
      "{{ .Option }}",
      "--unknown-flag",
    );

    try {
      customParseArgs({ args: argv, options: mockOptions, strict: true });
      expect.unreachable("Expected customParseArgs to throw an error");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      if (err instanceof Error) {
        const codedErr = err as CodedError;
        expect(codedErr.message).toBe(expectedError);
        expect(codedErr.code).toBe("ERR_PARSE_ARGS_UNKNOWN_OPTION");
      }
    }
  });

  test("customParseArgs successfully parses valid arguments", () => {
    const argv = ["--name", "Alice", "-v"];
    const { values } = customParseArgs({
      args: argv,
      options: mockOptions,
      strict: true,
    });
    expect(values.name).toBe("Alice");
    expect(values.verbose).toBe(true);
  });
});
