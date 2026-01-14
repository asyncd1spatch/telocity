# telocity

A CLI script for basic local LLM interactions.\
Not a srs program, just a playground for myself.\
Program's strings are a testbed for tiny local llm translation, all strings other than en-US.json are translated with [unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF), scripts/make_project_translations.ts shows how it's done, program uses the defaults other than what is specified in its cli run.

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

[MuXodious/gemma-3n-E4B-it-absolute-heresy-GGUF](https://huggingface.co/MuXodious/gemma-3n-E4B-it-absolute-heresy-GGUF) && [mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF](https://huggingface.co/mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF) The best in their size class for many language pairs and content that includes a lot of nerdy/subculture style writing/vocabulary. Using an abliterated version that hasn't damaged the model. Great vision capabilities too, if you need that, I prefer it over Qwen VL. One minus: those models are surprisingly slow for their size class, I do not know if it's because of the architecture or llama.cpp though.

[tencent/HY-MT1.5-1.8B-GGUF](https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF) && [tencent/HY-MT1.5-7B-GGUF](https://huggingface.co/tencent/HY-MT1.5-7B-GGUF) Almost as good, but does significantly worse on Japanese than Gemma (best in class) and Qwen. Better than similarly sized Qwen at translating Chinese, and they're lightning fast models if you require some performance. Unlike the others, they are not meant for general purpose usage and I haven't tested them outside of the context of translation.

[unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) large context king in its size range. It's almost unbelievable how many tokens it can ingest while remaining coherent, and how many it can output back. (this script's about 4k tokens worth of strings, and they are translated by the instruct version in one shot, no chunking, [while using the x2 prompt method](https://arxiv.org/html/2512.14982v1).) Overall a favorite for general purpose usage and for lazy one shot of a large amount of text.

[ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here. It won't code for you, but it'll do decent completions on repetitive patterns and save you some typing which is all I really want from a completion style model.

[unsloth/Qwen3-1.7B-GGUF](https://huggingface.co/unsloth/Qwen3-1.7B-GGUF) Most coherent of the smaller general purpose models. You can go for it if you're really, really starved for compute, but I'd recommend going for one of the models above otherwise.
