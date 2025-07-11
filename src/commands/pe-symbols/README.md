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

If the location is a directory, the command scans it recursively looking for PE files. For each PE file, it uploads the corresponding .PDB file to Datadog.
If the location is a file, the command uploads the corresponding .PDB file to Datadog.

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--replace-existing` | Optional | If symbol information with the same build ID is already present on Datadog side, discard it and use the newly uploaded information.<br>Default behavior is to only replace existing debug information if the newly uploaded information is considered a better source with the following ordering: debug info > symbol table > dynamic symbol table. |
