# Datadog CI

[![NPM Version](https://img.shields.io/npm/v/@datadog/datadog-ci)](https://www.npmjs.com/package/@datadog/datadog-ci) ![Continuous Integration](https://github.com/DataDog/datadog-ci/workflows/Continuous%20Integration/badge.svg) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![NodeJS Version](https://img.shields.io/badge/Node.js-14+-green)

Execute commands from your Continuous Integration (CI) and Continuous Delivery (CD) pipelines to integrate with existing Datadog products.

See the [Usage section](#usage) for a list of available commands.

## How to install the CLI

The package is under [@datadog/datadog-ci](https://www.npmjs.com/package/@datadog/datadog-ci) and can be installed through NPM or Yarn:

```sh
# NPM
npm install --save-dev @datadog/datadog-ci

# Yarn
yarn add --dev @datadog/datadog-ci
```

If you need `datadog-ci` as a CLI tool instead of a package, you can run it with [`npx`](https://www.npmjs.com/package/npx) or install it globally:

```sh
# npx
npx @datadog/datadog-ci [command]

# NPM install globally
npm install -g @datadog/datadog-ci

# Yarn v1 add globally
yarn global add @datadog/datadog-ci
```

For more ways to install the CLI, see [this section](#more-ways-to-install-the-cli).

## Usage

```bash
Usage: datadog-ci <command> [<subcommand>] [options]
```

The following values are available for each `<command>` and (optionally) `<subcommand>`.

See each command's linked README for more details, or click on [📚](https://docs.datadoghq.com/) to see the related documentation page.

#### `cloud-run`
- `flare`: Troubleshoot your issues with [Cloud Run service](src/commands/cloud-run) configuration. [📚](https://docs.datadoghq.com/serverless/google_cloud_run)

#### `dsyms`
- `upload`: Upload [iOS dSYM files](src/commands/dsyms) for Error Tracking (macOS only). [📚](https://docs.datadoghq.com/real_user_monitoring/error_tracking/ios/)

#### `flutter-symbols`
- `upload`: Upload [Flutter symbols](src/commands/flutter-symbols) for Error Tracking. [📚](https://docs.datadoghq.com/real_user_monitoring/error_tracking/flutter/)

#### `unity-symbols`
- `upload`: Upload [Unity symbols](src/commands/unity-symbols) for Error Tracking.

#### `git-metadata`
- `upload`: Upload [Git metadata](src/commands/git-metadata) for the Source Code Integration. [📚](https://docs.datadoghq.com/integrations/guide/source-code-integration/)

#### `junit`
- `upload`: Upload [JUnit test reports](src/commands/junit) for Test Visibility. [📚](https://docs.datadoghq.com/tests/setup/junit_xml/)

#### `lambda`
- `flare`: Troubleshoot your issues with Datadog instrumentation on your [AWS Lambda functions](src/commands/lambda).
- `instrument`: Apply Datadog instrumentation to the given [AWS Lambda functions](src/commands/lambda).
- `uninstrument`: Revert Datadog instrumentation from the given [AWS Lambda functions](src/commands/lambda).

#### `measure`

- Add [measures](src/commands/measure) to a CI Visibility pipeline trace or job span in Datadog. [📚](https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/)

#### `react-native`
- `codepush`: Upload [React Native CodePush sourcemaps](src/commands/react-native) for Error Tracking. [📚](https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/setup/codepush/)
- `upload`: Upload [React Native sourcemaps](src/commands/react-native) for Error Tracking. [📚](https://docs.datadoghq.com/real_user_monitoring/error_tracking/reactnative/)
- `xcode`: Upload [React Native sourcemaps](src/commands/react-native) for Error Tracking from the XCode bundle build phase. [📚](https://docs.datadoghq.com/real_user_monitoring/error_tracking/reactnative/)

#### `sarif`
- `upload`: Upload [Static Analysis Results Interchange Format (SARIF)](src/commands/sarif) reports to Datadog. [📚](https://docs.datadoghq.com/code_analysis/static_analysis/)

#### `sbom`
- `upload`: Upload [Software Bill of Materials (SBOM)](src/commands/sbom) files to Datadog. [📚](https://docs.datadoghq.com/code_analysis/software_composition_analysis/)

#### `sourcemaps`
- `upload`: Upload [JavaScript sourcemaps](src/commands/sourcemaps) for Error Tracking. [📚](https://docs.datadoghq.com/real_user_monitoring/guide/upload-javascript-source-maps)

#### `stepfunctions`
- `instrument`: Instrument [AWS Step Function](src/commands/stepfunctions) with Datadog to get logs and traces. [📚](https://docs.datadoghq.com/serverless/step_functions/installation/?tab=datadogcli)
- `uninstrument`: Uninstrument [AWS Step Function](src/commands/stepfunctions). [📚](https://docs.datadoghq.com/serverless/step_functions/installation/?tab=datadogcli)

#### `synthetics`
- `run-tests`: Run [Continuous Testing tests](src/commands/synthetics) from the CI. [📚](https://docs.datadoghq.com/continuous_testing/)
- `upload-application`: Upload a new version to an [existing mobile application](src/commands/synthetics) in Datadog. [📚](https://docs.datadoghq.com/mobile_app_testing/)

#### `tag`
- Add [custom tags](src/commands/tag) to a CI Visibility pipeline trace or job span in Datadog. [📚](https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/)

#### `trace`
- Add [custom commands](src/commands/trace) to a CI Visibility pipeline in Datadog. [📚](https://docs.datadoghq.com/continuous_integration/pipelines/custom_commands/)

### Beta commands

The following are **beta** commands, you can enable them with with `DD_BETA_COMMANDS_ENABLED=1`:

#### `deployment`
- `mark`: Mark a CI job as a [deployment](src/commands/deployment). [📚](https://docs.datadoghq.com/continuous_delivery/)

#### `dora`
- `deployment`: Send a new deployment event for [DORA Metrics](src/commands/dora) to Datadog. [📚](https://docs.datadoghq.com/dora_metrics/)

#### `elf-symbols`
- `upload`: Upload [Elf debug info files](src/commands/elf-symbols) for Profiling (requires binutils). [📚](https://docs.datadoghq.com/profiler/enabling/ddprof)

#### `gate`
- `evaluate`: Evaluate [Quality Gates](src/commands/gate) rules in Datadog. [📚](https://docs.datadoghq.com/quality_gates/)

## More ways to install the CLI

### Standalone binary (**beta**)

If installing NodeJS in the CI is an issue, standalone binaries are provided with [releases](https://github.com/DataDog/datadog-ci/releases). _linux-x64_, _darwin-x64_ (macOS), and _win-x64_ (Windows) are supported. **These standalone binaries are in beta and their stability is not guaranteed**.

To install:

#### Linux

```sh
curl -L --fail "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_linux-x64" --output "/usr/local/bin/datadog-ci" && chmod +x /usr/local/bin/datadog-ci
```

#### MacOS

```sh
curl -L --fail "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_darwin-x64" --output "/usr/local/bin/datadog-ci" && chmod +x /usr/local/bin/datadog-ci
```

#### Windows

```sh
Invoke-WebRequest -Uri "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_win-x64.exe" -OutFile "datadog-ci.exe"
```

Then, you can run `datadog-ci` commands normally:

```sh
datadog-ci version
```

### Container image

To run `datadog-ci` from a container, you can use the `datadog/ci` image available in [Docker Hub](https://hub.docker.com/r/datadog/ci) as well as the public [Amazon ECR](https://gallery.ecr.aws/datadog/ci) and [Google GC](https://console.cloud.google.com/gcr/images/datadoghq/global/ci) registries.

```shell
docker pull datadog/ci
```

This example demonstrates how to run a command using the container and passing in the API and app keys:

```shell
export DD_API_KEY=$(cat /secret/dd_api_key)
export DD_APP_KEY=$(cat /secret/dd_app_key)
docker run --rm -it -v $(pwd):/w -e DD_API_KEY -e DD_APP_KEY datadog/ci synthetics run-tests -p pub-lic-id1
```

#### Building your own container image

You can build an image using the provided [Dockerfile](https://github.com/DataDog/datadog-ci/blob/master/container/Dockerfile):

```sh
cd container
docker build --tag datadog-ci .
```

Optionally, you can use the `VERSION` build argument to build an image for a specific version:

```sh
docker build --build-arg "VERSION=v1.14" --t datadog-ci .
```

## Development

Before contributing to this open source project, read our [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License, v2.0](LICENSE)
