## Overview

Upload WebAssembly source maps (`*.wasm.map`) to Datadog to deobfuscate WASM stack traces.

This command is separate from `wasm-symbols upload`, which uploads WebAssembly modules containing DWARF debug information and identifies them by build ID. WASM source maps are identified by service, version, and the public URL of the corresponding `.wasm` module.

## Setup

Set `DD_API_KEY` in your environment. Set `DD_SITE` when uploading to a site other than `datadoghq.com`.

## `upload`

```bash
DD_BETA_COMMANDS_ENABLED=1 datadog-ci wasm-sourcemaps upload ./build/web \
  --service checkout-web \
  --release-version 1.0.0 \
  --minified-path-prefix https://cdn.example.com/flutter/
```

The command recursively finds `*.wasm.map` files. Each source map must be next to its corresponding `.wasm` module. The relative module path is appended to `--minified-path-prefix` to produce the URL used for symbolication.

| Parameter                | Condition | Description                                                         |
| ------------------------ | --------- | ------------------------------------------------------------------- |
| `<path>`                 | Required  | Build directory to scan recursively, or a single `*.wasm.map` file. |
| `--service`              | Required  | Service reported by the application.                                |
| `--release-version`      | Required  | Version reported by the application.                                |
| `--minified-path-prefix` | Required  | Public URL or absolute path prefix for the `.wasm` modules.         |
| `--dry-run`              | Optional  | Discover and validate source maps without uploading them.           |
| `--max-concurrency`      | Optional  | Maximum concurrent uploads. Defaults to 20.                         |
| `--disable-git`          | Optional  | Do not attach Git repository metadata.                              |
| `--repository-url`       | Optional  | Override the detected Git repository URL.                           |
