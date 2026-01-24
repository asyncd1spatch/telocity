# telocity

A CLI script for basic local LLM interactions.\
Not a srs program, just a playground for myself.\
Program's strings are a testbed for tiny local llm translation, all strings other than en-US.json are translated with [mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF](https://huggingface.co/mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF), scripts/make_project_translations.ts shows how it's done, program uses the defaults other than what is specified in its cli run.

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

Anytime an heretic goof has been uploaded, I highly recommend using it over the original model. Unlike abliteration methods of the past, there's really no loss of quality and you gain a model that will get less prissy if you translate content with vulgarity or whatever else doesn't make the PC police happy.  
I used to keep a mix of models but now I only keep the heretic versions on my drive.

[mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF](https://huggingface.co/mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF) large context king in its size range. It's unbelievable how many tokens it can ingest while remaining coherent, and how many it can output back. (this script's about 4k tokens worth of strings, and they are translated by the instruct version in one shot, no chunking, [while using the x2 prompt method](https://arxiv.org/html/2512.14982v1).) Overall a favorite for general purpose usage and for lazy one shot of a large amount of text.

[mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF](https://huggingface.co/mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF) && [MuXodious/gemma-3n-E4B-it-absolute-heresy-imatrix-GGUF](https://huggingface.co/MuXodious/gemma-3n-E4B-it-absolute-heresy-imatrix-GGUF) The best in their size class for many language pairs and content that includes a lot of nerdy/subculture style writing/vocabulary. One minus: those models are surprisingly slow for their size class, I do not know if it's because of the architecture or llama.cpp though. A tad quirky in its instruction following compared to Qwen but more palatable writing. YMMV

[mradermacher/Heretic-HY-MT1.5-1.8B-GGUF](https://huggingface.co/mradermacher/Heretic-HY-MT1.5-1.8B-GGUF) It's close to the level of Qwen 4B in some language pairs, worse in others, a bit more variable in general quality but impressive for a 1.8B model and lightning fast inference.

[ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here. It won't code for you, but it'll do decent completions on repetitive patterns and save you some typing which is all I really want from a completion style model.
