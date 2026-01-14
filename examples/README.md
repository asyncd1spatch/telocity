just my personal presets for llama.cpp which can serve as examples

```sh
llama-server --models-preset $LLAMA_MODELS_DIR/presets.ini --models-max 1 --webui-config-file $LLAMA_MODELS_DIR/webuiconfig.json
```

for batch processing:

```sh
llama-server --models-preset $LLAMA_MODELS_DIR/presets.ini --models-max 1 --no-webui --cache-ram 0 --no-cache-prompt
```

with grammar:

```sh
llama-server --grammar-file $LLAMA_MODELS_DIR/latin9.gbnf --models-preset $LLAMA_MODELS_DIR/presets.ini --models-max 1 --no-webui --cache-ram 0 --no-cache-prompt
```
