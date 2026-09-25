## Overview

Upload Windows PE debug info files to Datadog to symbolicate your profiles.


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

**Warning:** The `pe-symbols upload` command is in beta. It requires you to set `DD_BETA_COMMANDS_ENABLED=1`.

This command will upload debug info from Windows PE files to Datadog in order to symbolicate your application's profiles.

Run the following command to upload all the necessary files:

```bash
DD_BETA_COMMANDS_ENABLED=1 datadog-ci pe-symbols upload ~/your/build/bin/
```

If the location is a directory, the command scans it recursively looking for PE files.
For each PE file, it uploads the matching .PDB by default, preserving the profiling upload behavior.
If the location is a file, the command uploads its matching .PDB.
Files without a matching PDB are skipped.

Add `--include-unwind-info` to also upload the information Datadog needs to unwind minidump stack traces:

- **x64:** a reduced copy of the EXE/DLL is uploaded alongside the PDB. It keeps only the module identity, section addresses, the exception table and the unwind records. Code, data, resources, and the PDB path are removed, and the original binary is never uploaded.
- **x86:** only the PDB is uploaded, and its frame data is used for unwinding.
- **ARM and ARM64EC:** not supported. These modules fail, and nothing is uploaded for them.

If a binary's unwind data cannot be extracted, nothing is uploaded for that module. The command never falls back to uploading the complete binary.
Breakpad `.sym` files already contain unwind records and are uploaded unchanged.

```bash
DD_BETA_COMMANDS_ENABLED=1 datadog-ci pe-symbols upload ~/your/build/bin/ --include-unwind-info
```

If the symbols were already uploaded without unwind information, also pass `--replace-existing`.

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--include-unwind-info` | Optional | Upload unwind information for minidump stack walking: a reduced copy of x64 EXE/DLL files without code or data, or the PDB frame data for x86. Disabled by default. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--replace-existing` | Optional | If symbol information with the same build ID is already present on Datadog side, discard it and use the newly uploaded information.<br>Default behavior is to only replace existing debug information if the newly uploaded information is considered a better source with the following ordering: debug info > symbol table > dynamic symbol table. |
