# telocity

A CLI script for basic local LLM interactions.\
Not a srs program, just a playground for myself.\
Program's strings are a testbed for tiny local llm translation, all strings other than en-US.json are translated with [unsloth/ERNIE-4.5-21B-A3B-PT-GGUF](https://huggingface.co/unsloth/ERNIE-4.5-21B-A3B-PT-GGUF).

## Installation

Use the prepackaged bun+script executable releases if provided, or install the [Bun javascript runtime](https://bun.com/), unpack the project where you want it installed and then:

```bash
bun install
bun link
```

It is also compatible with Node (but slower startup), to install,
unpack the repository where you want to run it and:

```bash
npm install
npm install -g .
```

Generate bash completions with

```bash
telocity co > _telocity_completions
```

## Recommended local models for us vramlets

[unsloth/ERNIE-4.5-21B-A3B-PT-GGUF](https://huggingface.co/unsloth/ERNIE-4.5-21B-A3B-PT-GGUF) quite the coherent model for its size, functional even at smaller quants.

[unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) && [unsloth/Qwen3-4B-Thinking-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Thinking-2507-GGUF) large context king in its size range.

[unsloth/Qwen3-VL-4B-Instruct-GGUF](https://huggingface.co/unsloth/Qwen3-VL-4B-Instruct-GGUF) && [unsloth/Qwen3-VL-4B-Thinking-GGUF](https://huggingface.co/unsloth/Qwen3-VL-4B-Thinking-GGUF) high quality vision on lower end hardware.

[ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here.

[unsloth/Qwen3-1.7B-GGUF](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF) Most coherent of the smaller models.
