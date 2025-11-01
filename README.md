# telocity

A CLI script for basic local LLM interactions.\
Not a srs program, just a playground for myself.\
Program's strings are a testbed for tiny local llm translation, all strings other than en-US.json are translated with unsloth/Qwen3-4B-Instruct-2507.

## Installation

Use the prepackaged bun+script executable releases if provided, or install the [Bun javascript runtime](https://bun.com/) and then:

```bash
bun add -g "$(pwd)/telocity-version.tgz"
```

Generate bash completions with

```
telocity co > _telocity_completions
```

## Recommended local models for us vramlets

[second-state/gemma-3n-E4B-it-GGUF](https://huggingface.co/second-state/gemma-3n-E4B-it-GGUF) && [second-state/gemma-3n-E2B-it-GGUF](https://huggingface.co/second-state/gemma-3n-E2B-it-GGUF) the absolute winners in this field, best for local translation, world knowledge etc. I selected those quants because they're smaller at similar quantization level than the others at no loss in my usage (might have something to do with other quanters packing the vision bits we can't use?). Still perform great at Q4_0 (fastest quant to run).

[stduhpf/google-gemma-3-4b-it-qat-q4_0-gguf-small](https://huggingface.co/stduhpf/google-gemma-3-4b-it-qat-q4_0-gguf-small) worse than 3n, possibly better large context (but Qwen does even better), mainy chosen for its vision support in llama.cpp. Again, a particular set of quants that are more efficient than the others online, I see a theme, Gemma?

[unsloth/Qwen3-4B-Instruct-2507-GGUF](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF) large context king. Capable of outputting 6k tokens worth of json without any syntax error in one go. (in real use you should go with constrained decoding, but for testing model coherence in large context I find this is a good test.) UD K XL quants highly recommended.

[ggml-org/Qwen2.5-Coder-3B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-3B-Q8_0-GGUF) && [ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF](https://huggingface.co/ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF) pretty decent fill-in-the-middle. Don't go any lower than Q8 here.

[stduhpf/google-gemma-3-1b-it-qat-q4_0-gguf-small](https://huggingface.co/stduhpf/google-gemma-3-1b-it-qat-q4_0-gguf-small) it's starting to be too small for general purpose uses, but surprisingly usable for certain text instructions.

[ggml-org/embeddinggemma-300M-qat-q4_0-GGUF](https://huggingface.co/ggml-org/embeddinggemma-300M-qat-q4_0-GGUF) embed supreme.
