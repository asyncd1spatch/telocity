just my personal presets for llama.cpp which can serve as examples

```sh
llama-server --samplers "penalties;top_k;top_p;temperature" --models-preset $LLAMA_CNF_DIR/presets.ini --models-max 1 --webui-config-file $LLAMA_CNF_DIR/webuiconfig.json --parallel 16 --kv-unified
```

for batch processing with grammar to suppress the output of tokens not part of the latin9 charset:

```sh
llama-server --samplers "penalties;top_k;top_p;temperature" --grammar-file $LLAMA_CNF_DIR/latin9.gbnf --models-preset $LLAMA_CNF_DIR/presets.ini --models-max 1 --webui-config-file $LLAMA_CNF_DIR/webuiconfig.json --parallel 16 --kv-unified --cache-ram 0 --no-cache-prompt
```
