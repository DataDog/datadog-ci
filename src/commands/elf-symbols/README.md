## Overview

Upload elf debug info files to Datadog to symbolicate your profiles.

## Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

You can configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable as `datadoghq.eu`. By default, the requests are sent to Datadog US.

To make these variables available, Datadog recommends setting them in an encrypted `datadog-ci.json` file at the root of your project:

```json
{
  "apiKey": "<DATADOG_API_KEY>",
  "datadogSite": "<DATADOG_SITE>"
}
```

To override the full URL for the intake endpoint, define the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

## Commands

### `upload`

This command will upload your debug info files to Datadog in order to symbolicate your application's stack traces.

You are then able to run the following command to upload all the necessary files:

```bash
datadog-ci elf-symbols upload --symbols-location datadogSymbols
```

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--symbols-location`  | Optional  | The location of of your dSYMs, `build_id` and `LineNumberMappings.json` file.  Defaults to `datadogSymbols`. |
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
