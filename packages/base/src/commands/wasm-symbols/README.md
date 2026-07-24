## Overview

Upload WebAssembly (`.wasm`) debug info files to Datadog to symbolicate WASM stack traces reported by the Datadog Browser SDK.

## Setup

You need to have `DD_API_KEY` in your environment.

```bash
# Environment setup
export DD_API_KEY="<API KEY>"
```

You can configure the tool to use Datadog EU by defining the `DD_SITE` environment variable as `datadoghq.eu`. By default, the requests are sent to Datadog US.

To make these variables available, Datadog recommends setting them in an encrypted `datadog-ci.json` file at the root of your project:

```json
{
  "apiKey": "<API_KEY>",
  "datadogSite": "<SITE>"
}
```

To override the full URL for the intake endpoint, define the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

## Commands

### `upload`

This command will upload debug info from WASM files to Datadog in order to symbolicate your application's WASM stack traces.

Run the following command to upload all the necessary files:

```bash
datadog-ci wasm-symbols upload ~/your/build/output/
```

If location is a directory, the command will scan it recursively looking for `.wasm` files. If location is a file, only that file is uploaded.

A `.wasm` file is only uploaded if it carries debug information: either embedded DWARF debug sections (produced by e.g. `emcc -g`, `wasm-pack build --dev`) or a custom `external_debug_info` section pointing at a separate debug artifact.

The module's identifier is read from a `build_id` custom section if present. If absent, it falls back to a SHA-256 hash of the module's code section, which the Datadog Browser SDK computes the same way at runtime — so lookups keep working even for toolchains that don't emit a `build_id` section.

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--replace-existing` | Optional | If symbol information with the same build ID is already present on Datadog side, discard it and use the newly uploaded information.<br>Default behavior is to only replace existing debug information if the newly uploaded information is considered a better source with the following ordering: embedded debug info > external debug info reference. |
| `--arch` | Optional | The target WASM architecture: `wasm32` or `wasm64`. Defaults to `wasm32`. |
| `--source-url` | Optional | The URL the module is served from in production. Used as an additional lookup key for engines that key module identity by fetch URL (e.g. `WebAssembly.instantiateStreaming`). |
