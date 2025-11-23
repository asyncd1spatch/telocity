# telocity

A CLI script for basic local LLM interactions.\
Not a srs program, just a playground for myself.\
Program's strings are a testbed for tiny local llm translation, all strings other than en-US.json are translated with ggml-org/gpt-oss-20b-GGUF.\
gpt-oss and the newer qwen models are, so far, the only models I've found reliable at doing something as inane as feeding em 5.5k tokens worth of json with no constrained decoding, asking for a one shot translation and receiving something coherent enough with no syntax error. You'd chunk more and use grammars in real world usage but seeing models that small running on home computers capable of doing this.. I'm feeling it, real progress. Local LLMs have gotten much more useful compared to the days of 4k context models.

## Installation

Use the prepackaged bun+script executable releases if provided, or install the [Bun javascript runtime](https://bun.com/), unpack the project where you want it installed and then:

```bash
bun install
bun link
```

It is also compatible with Node (but slower), to install,
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

[ggml-org/gpt-oss-20b-GGUF](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF) The best choice if you have the RAM (or VRAM, some gamer GPUs can hold it whole). It's still small enough as a MoE that it can run with acceptable performance on a CPU/GPU split.

[unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) && [unsloth/Qwen3-4B-Thinking-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Thinking-2507-GGUF) large context king in its size range.

[unsloth/Qwen3-VL-4B-Instruct-GGUF](https://huggingface.co/unsloth/Qwen3-VL-4B-Instruct-GGUF) && [unsloth/Qwen3-VL-4B-Thinking-GGUF](https://huggingface.co/unsloth/Qwen3-VL-4B-Thinking-GGUF) high quality vision on lower end hardware.

[ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here.

[unsloth/Qwen3-1.7B-GGUF](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF) Most coherent of the smaller models.
