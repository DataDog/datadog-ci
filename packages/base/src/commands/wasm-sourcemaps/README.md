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

The command recursively finds `*.wasm.map` files. The corresponding `.wasm` modules do not need to be present locally and are not uploaded. The module path is derived by removing the final `.map` extension from each source map's relative path, then appended to `--minified-path-prefix` to produce the URL used for symbolication. The source maps' directory layout must match the deployed modules' layout under that prefix.

For example, `./build/web/nested/main.dart.wasm.map` with prefix `https://cdn.example.com/app/` is uploaded with `minified_url: https://cdn.example.com/app/nested/main.dart.wasm`. Sourcemap-processor extracts domain `cdn.example.com` and absolute path `/app/nested/main.dart.wasm` from that URL. An absolute-path-only prefix leaves the domain empty. These paths identify the generated `.wasm` module, not the `.wasm.map` file or the original source files.

When uploading a single source map, the module path is relative to that file's parent directory. Include any deployed subdirectory in the prefix: uploading `./build/web/nested/main.dart.wasm.map` individually requires prefix `https://cdn.example.com/app/nested/` to produce the same URL as the directory upload above.

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
