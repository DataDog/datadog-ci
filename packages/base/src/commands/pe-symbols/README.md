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
For each PE file, it uploads the EXE/DLL and its matching .PDB together by default.
If the location is a file, the command uploads that PE file and its matching .PDB.
Files without a matching PDB are skipped.

The request includes `generate_cfi_cache: true`. The backend uses the PDB for
symbol names and the PE binary for supported unwind information. This increases
upload size compared with PDB-only uploads, but the companion EXE/DLL is deleted
after successful processing and database indexing; the PDB and generated caches
are retained. Inputs remain available for retries until indexing succeeds.
Breakpad `.sym` uploads remain a single attachment and use their own unwind records.

If the symbols were already uploaded without unwind information, also pass
`--replace-existing`. Deploy backend support for paired uploads before releasing
this CLI change; older processors do not consume the companion attachment. Unsupported
or absent unwind data does not guarantee a CFI cache will be generated.

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--replace-existing` | Optional | If symbol information with the same build ID is already present on Datadog side, discard it and use the newly uploaded information.<br>Default behavior is to only replace existing debug information if the newly uploaded information is considered a better source with the following ordering: debug info > symbol table > dynamic symbol table. |
