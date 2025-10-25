# telocity

A CLI script for basic local LLM interactions.

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

[gpt-oss-20b](https://huggingface.co/ggml-org/gpt-oss-20b-GGUF) The goldstandard for vramlets. Pretty good speed for a larger model, all rounder in uses.

[gemma-3n-E4B-it](https://huggingface.co/second-state/gemma-3n-E4B-it-GGUF) for its surprising breadth of knowledge for such a tiny model which makes it really nice for local novel translations.
