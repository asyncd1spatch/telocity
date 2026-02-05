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

[mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF](https://huggingface.co/mradermacher/Qwen3-4B-Instruct-2507-heretic-av2-i1-GGUF) large context king in its size range. It's unbelievable how many tokens it can ingest while remaining coherent, and how many it can output back. (this script's around 4k tokens worth of strings, and they are translated by the instruct version in one shot, no chunking, [while using the x2 prompt method](https://arxiv.org/html/2512.14982v1).) Overall a favorite for general purpose usage and for lazy one shot of a large amount of text. **{Recommended minimum quantization] size: Q5_K_M.** Anything lower will show significant degradation.

[mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF](https://huggingface.co/mradermacher/gemma-3n-E2B-it-absolute-heresy-i1-GGUF) && [MuXodious/gemma-3n-E4B-it-absolute-heresy-imatrix-GGUF](https://huggingface.co/MuXodious/gemma-3n-E4B-it-absolute-heresy-imatrix-GGUF) The best in their size class for many language pairs and content that includes a lot of nerdy/subculture style writing/vocabulary. One minus: those models are surprisingly slow for their size class, I do not know if it's because of the architecture or llama.cpp though. A tad quirky in its instruction following compared to Qwen but more palatable writing. Has vision support. **{Recommended minimum quantization] size: Q4_K_M.** You could possibly go even lower, I haven't tried, this model at least in the context of translation remains high performance at this level of quantization. Being a model that can lose half of its parameters (E2B vs E4B) while remaining highly coherent seems to also impact quantization resilience.

[stduhpf/google-gemma-3-4b-it-qat-q4_0-gguf-small](https://huggingface.co/stduhpf/google-gemma-3-4b-it-qat-q4_0-gguf-small) well rounded model, neither best nor worst at anything, and pretty fast and efficient, with vision support. E2B/E4B provides superior translations, but 4b qat is much faster and can run on less vram (it's also faster than E2B, despite comparable model sizes). **It's qat so Q4_0 is all you should gun for.**

[ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here. It won't code for you, but it'll do decent completions on repetitive patterns and save you some typing which is all I really want from a completion style model. **{Recommended minimum quantization] size: Q8_0.** It's already small enough anyway, and you want the highest level of coherence for a decent autocomplete.

[mradermacher/Qwen3-1.7B-GGUF](https://huggingface.co/mradermacher/Qwen3-1.7B-GGUF) most coherent micro sized general purpose model. **{Recommended minimum quantization] size: Q8_0.** From my testing, it could still be an actually useful model in certain tasks at Q8, but anything lower will completely destroy it. Seems like models under 2B are when you start to see high levels of degradation as a whole from any form of quantization.
