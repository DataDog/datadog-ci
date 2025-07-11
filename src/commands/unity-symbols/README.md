## Overview

To deobfuscate and symbolicate errors and crashes, upload IL2CPP mappings and iOS dSYMs to Datadog.

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

This command uploads your IL2CPP mapping file, iOS dSYMs, Android .so, and Android Proguard mapping files to Datadog in order to deobfuscate and symbolicate your application's stack traces.

After performing a build, run the following command from your exported build directory to upload all the necessary files:

For iOS:
```bash
datadog-ci unity-symbols upload --ios
```

For Android:
```bash
datadog unity-symbols upload --android
```

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--ios` or `--android` | One is required | Specify the platform we are uploading symbols for, iOS or Android |
| `--symbols-location`  | Optional | The location of your `dSYMs`, `.sos`, `build_id` and `LineNumberMappings.json` file.  Defaults to `datadogSymbols` on iOS and `/unityLibrary/symbols` on Android. |
| `--dry-run` | Optional | Run the command without the final step of uploading. All other checks are performed. |
| `--max-concurrency` | Optional | The number of concurrent uploads to the API. Defaults to 20. |
| `--disable-git`    | Optional | Prevents the command from invoking Git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |
| `--skip-il2cpp` | Optional | Skip uploading the IL2CPP mapping file. |
