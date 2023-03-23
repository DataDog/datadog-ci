## Overview

To deobfuscate and symbolicate errors and crashes, upload your Flutter Symbols, iOS dSYMs, and Android mapping files to Datadog.

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

This command uploads your Dart symbol files, iOS dSYMs, and Android Proguard mapping files to Datadog in order to deobfuscate and symbolicate your application's stack traces.

After running `flutter build --split-debug-info=./debug-info --obfuscate`, you can upload all files to Datadog by running this command: 

```bash
datadog-ci flutter-symbols upload --dart-symbols-location ./debug-info --service-name com.companyname.application --ios-dsyms --android-mapping
```

| Parameter | Condition | Description |
|-----------|-----------|-------------|
| `--service-name` | Required | Set as the service name you are uploading files for. Datadog uses this service name to find corresponding files based on the `service` options set when you configured the Datadog Flutter SDK for RUM.<br>By default, the Datadog Flutter SDK for RUM uses your application's bundle identifier as the service. |
| `--flavor` | Optional | The build flavor that was built. Only one upload is needed for a specific `version`, `service`, and `flavor` combination. Subsequent uploads are ignored until one parameter changes. Defaults to `release`. |
| `--dart-symbols-location`  | Optional  | The location of your Dart symbol files. This should be the same path specified to `--split-debug-info`. |
| `--ios-dsyms` | Optional | Upload iOS dSYM files to Datadog. |
| `--ios-dsyms-location` | Optional | Specify the location of iOS dSYM files. By default, these are located at `./build/ios/archive/Runner.xcarchive/dSYMs`. Adding this parameter automatically sets `--ios-dsyms`. |
| `--android-mapping` | Optional | Upload Android Proguard mapping file. This is usually only necessary if you specify `--obfuscate` as a parameter to `flutter build`. |
| `--android-mapping-location` | Optional | Specify the location of your Android Proguard mapping file. By default, this is located at `./build/app/outputs/mapping/[flavor]/mapping.txt`. Adding this parameter automatically sets `--android-mapping`. |
| `--pubspec-location` | Optional | The location of the pubspec for this application. The pubspec is used to automatically determine the version number of the application. Defaults to the current directory. |
| `--version` | Optional | The version of your application. This defaults to the version specified in your pubspec. Only one upload is needed for a specific `version`, `service`, and `flavor` combination. Subsequent uploads are ignored until one parameter changes. |
| `--dry-run` | Optional | It runs the command without the final step of uploading. All other checks are performed. |
| `--disable-git`    | Optional   | Prevents the command from invoking git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url` | Optional | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`. |

