## Overview

Upload WebAssembly debug info files (`.wasm`)  to Datadog to symbolicate WASM stack traces reported by the Datadog Browser SDK.

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

A `.wasm` file is only uploaded if it carries embedded DWARF debug sections (produced by e.g. `emcc -g`, `wasm-pack build --dev`). A file that only has a custom `external_debug_info` section pointing at a separate debug artifact is skipped, since that reference isn't resolved or uploaded.

The module's identifier is read from a `build_id` custom section. A `.wasm` file without one is skipped, since there is no key to look up its symbols by.

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--replace-existing` | Optional | If symbol information with the same build ID is already present on Datadog side, discard it and use the newly uploaded information.<br>Default behavior is to keep the first-seen file for a given build ID and skip the rest. |
