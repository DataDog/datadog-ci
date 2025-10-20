# Datadog CI

[![NPM Version](https://img.shields.io/npm/v/@datadog/datadog-ci)](https://www.npmjs.com/package/@datadog/datadog-ci) [![Continuous Integration](https://github.com/DataDog/datadog-ci/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/DataDog/datadog-ci/actions/workflows/ci.yml?query=branch%3Amaster) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![NodeJS Version](https://img.shields.io/badge/Node.js-18+-green)

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
npx @datadog/datadog-ci@v4 [scope]

# NPM install globally
npm install -g @datadog/datadog-ci

# Yarn v1 add globally
yarn global add @datadog/datadog-ci
```

For more ways to install the CLI, see [this section](#more-ways-to-install-the-cli).

## Installing a plugin

Plugins are separate packages that were split from the `@datadog/datadog-ci` package to reduce its installation size.

Use `datadog-ci plugin list` to list the available plugins:

```sh
datadog-ci plugin list
```

Use `datadog-ci plugin install` to install a plugin:

```sh
datadog-ci plugin install <scope>
```

By default, running a command that requires a plugin will automatically install the plugin if it is not already installed. You can disable this behavior with `DISABLE_PLUGIN_AUTO_INSTALL=1`.

## Usage

```bash
Usage: datadog-ci <scope> <command> [options]
```

The following `<scope>` and `<command>` values are available.

#### `aas`

<sub>**README:** [📚](/packages/plugin-aas) | **Documentation:** [🔗](https://docs.datadoghq.com/serverless/azure_app_services/) | **Plugin:** `@datadog/datadog-ci-plugin-aas`</sub>

- `instrument`: Apply Datadog instrumentation to the given Azure App Services.
- `uninstrument`: Revert Datadog instrumentation from the given Azure App Services.

#### `cloud-run`

<sub>**README:** [📚](/packages/plugin-cloud-run) | **Documentation:** [🔗](https://docs.datadoghq.com/serverless/google_cloud_run/) | **Plugin:** `@datadog/datadog-ci-plugin-cloud-run`</sub>

- `flare`: Troubleshoot your issues with Cloud Run service configuration.
- `instrument`: Apply Datadog instrumentation to the given Cloud Run Services.
- `uninstrument`: Revert Datadog instrumentation from the given Cloud Run Services.

#### `coverage`

<sub>**README:** [📚](/packages/plugin-coverage) | **Documentation:** [🔗](https://docs.datadoghq.com/code_coverage/)</sub>

- `upload`: Upload code coverage report files to Datadog.

#### `dora`

<sub>**README:** [📚](/packages/plugin-dora) | **Documentation:** [🔗](https://docs.datadoghq.com/dora_metrics/)</sub>

- `deployment`: Send a new deployment event for DORA Metrics to Datadog.

#### `dsyms`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/dsyms) | **Documentation:** [🔗](https://docs.datadoghq.com/real_user_monitoring/error_tracking/ios/)</sub>

- `upload`: Upload iOS dSYM files for Error Tracking (macOS only).

#### `flutter-symbols`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/flutter-symbols) | **Documentation:** [🔗](https://docs.datadoghq.com/real_user_monitoring/error_tracking/flutter/)</sub>

- `upload`: Upload Flutter symbols for Error Tracking.

#### `gate`

<sub>**README:** [📚](/packages/plugin-gate) | **Documentation:** [🔗](https://docs.datadoghq.com/quality_gates/)</sub>

- `evaluate`: Evaluate Quality Gates rules in Datadog.

#### `git-metadata`

<sub>**README:** [📚](/packages/base/src/commands/git-metadata) | **Documentation:** [🔗](https://docs.datadoghq.com/integrations/guide/source-code-integration/)</sub>

- `upload`: Upload Git metadata for the Source Code Integration.

#### `junit`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/junit) | **Documentation:** [🔗](https://docs.datadoghq.com/tests/setup/junit_xml/)</sub>

- `upload`: Upload JUnit test reports for Test Visibility.

#### `lambda`

<sub>**README:** [📚](/packages/plugin-lambda) | **Documentation:** [🔗](https://docs.datadoghq.com/serverless/aws_lambda/) | **Plugin:** `@datadog/datadog-ci-plugin-lambda`</sub>

- `flare`: Troubleshoot your issues with Datadog instrumentation on your AWS Lambda functions.
- `instrument`: Apply Datadog instrumentation to the given AWS Lambda functions.
- `uninstrument`: Revert Datadog instrumentation from the given AWS Lambda functions.

#### `measure`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/measure) | **Documentation:** [🔗](https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/)</sub>

- Add measures to a CI Visibility pipeline trace or job span in Datadog.

#### `pe-symbols`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/pe-symbols) | **Documentation:** [🔗](https://docs.datadoghq.com/profiler/enabling/ddprof/)</sub>

- `upload`: Upload Windows PE debug info files for Profiling.

#### `react-native`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/react-native) | **Documentation:** [🔗](https://docs.datadoghq.com/real_user_monitoring/error_tracking/reactnative/)</sub>

- `codepush`: Upload React Native CodePush sourcemaps for Error Tracking. [🔗](https://docs.datadoghq.com/real_user_monitoring/mobile_and_tv_monitoring/setup/codepush/)
- `upload`: Upload React Native sourcemaps for Error Tracking. 
- `xcode`: Upload React Native sourcemaps for Error Tracking from the XCode bundle build phase.

#### `sarif`

<sub>**README:** [📚](/packages/plugin-sarif) | **Documentation:** [🔗](https://docs.datadoghq.com/code_analysis/static_analysis/)</sub>

- `upload`: Upload Static Analysis Results Interchange Format (SARIF) reports to Datadog.

#### `sbom`

<sub>**README:** [📚](/packages/plugin-sbom) | **Documentation:** [🔗](https://docs.datadoghq.com/code_analysis/software_composition_analysis/)</sub>

- `upload`: Upload Software Bill of Materials (SBOM) files to Datadog. 

#### `sourcemaps`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/sourcemaps) | **Documentation:** [🔗](https://docs.datadoghq.com/real_user_monitoring/guide/upload-javascript-source-maps/)</sub>

- `upload`: Upload JavaScript sourcemaps for Error Tracking.

#### `stepfunctions`

<sub>**README:** [📚](/packages/plugin-stepfunctions) | **Documentation:** [🔗](https://docs.datadoghq.com/serverless/step_functions/installation/?tab=datadogcli) | **Plugin:** `@datadog/datadog-ci-plugin-stepfunctions`</sub>

- `instrument`: Instrument AWS Step Function with Datadog to get logs and traces.
- `uninstrument`: Uninstrument AWS Step Function.

#### `synthetics`

<sub>**README:** [📚](/packages/plugin-synthetics) | **Plugin:** `@datadog/datadog-ci-plugin-synthetics`</sub>

- `run-tests`: Run Continuous Testing tests from the CI. [🔗](https://docs.datadoghq.com/continuous_testing/)
- `upload-application`: Upload a new version to an existing mobile application in Datadog. [🔗](https://docs.datadoghq.com/mobile_app_testing/)

#### `tag`

<sub>**README:** [📚](/packages/base/src/commands/tag) | **Documentation:** [🔗](https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/)</sub>

- Add custom tags to a CI Visibility pipeline trace or job span in Datadog.

#### `trace`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/trace) | **Documentation:** [🔗](https://docs.datadoghq.com/continuous_integration/pipelines/custom_commands/)</sub>

- Add custom commands to a CI Visibility pipeline in Datadog.

#### `unity-symbols`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/unity-symbols) | **Documentation:** [🔗](https://docs.datadoghq.com/real_user_monitoring/error_tracking/unity/)</sub>

- `upload`: Upload Unity symbols for Error Tracking.

### Beta commands

The following are **beta** commands, you can enable them with with `DD_BETA_COMMANDS_ENABLED=1`:

#### `deployment`

<sub>**README:** [📚](/packages/plugin-deployment) | **Documentation:** [🔗](https://docs.datadoghq.com/continuous_delivery/)</sub>

- `mark`: Mark a CI job as a deployment.
- `correlate`: Correlate GitOps CD deployments with application repositories CI pipelines. [🔗](https://docs.datadoghq.com/continuous_delivery/deployments/argocd#correlate-deployments-with-ci-pipelines)
- `correlate-image`: Correlate an image from a CD provider with its source commit. [🔗](https://docs.datadoghq.com/continuous_delivery/deployments/argocd#correlate-images-with-source-code)
- `gate`: Evaluate a Deployment Gate. [🔗](https://docs.datadoghq.com/deployment_gates/)

#### `elf-symbols`

<sub>**README:** [📚](/packages/datadog-ci/src/commands/elf-symbols) | **Documentation:** [🔗](https://docs.datadoghq.com/profiler/enabling/ddprof/)</sub>

- `upload`: Upload Elf debug info files for Profiling.

### FIPS support

The `fips` option allows `datadog-ci` to use a FIPS cryptographic module provider if the OpenSSL library installed on the host system provides it.

**Note**: `datadog-ci` cannot assert if such a provider is available, and doesn't throw any error if the provider is not FIPS validated.

Node.js versions below 17 are incompatible with OpenSSL 3, which provides FIPS support.
If you are using a Node.js version below 17, enabling the `fips` option causes the command to throw an error.
The option `fips-ignore-error` ignores this error.
The released `datadog-ci` binary now uses Node.js version 18 to be compatible with OpenSSL 3.

#### `fips`
Enable `datadog-ci` FIPS support if a FIPS validated provider is installed on the host system.
If you do not have a FIPS provider installed, `datadog-ci` does not raise an error.

ENV variable: `DATADOG_FIPS=true`
CLI param: `--fips`

#### `fips-ignore-error`
Ignore Node.js errors if FIPS cannot be enabled on the host system.

**Note**: the absence of an error doesn't indicate that FIPS is enabled successfully.

ENV variable: `DATADOG_FIPS_IGNORE_ERROR=true`
CLI param: `--fips-ignore-error`


## More ways to install the CLI

### Standalone binary

If installing NodeJS in the CI is an issue, standalone binaries are provided with [releases](https://github.com/DataDog/datadog-ci/releases). _linux-x64_, _linux-arm64_, _darwin-x64_, _darwin-arm64_ (MacOS) and _win-x64_ (Windows) are supported.

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
Invoke-WebRequest -Uri "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_win-x64" -OutFile "datadog-ci.exe"
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
docker run --rm -it -v $(pwd):/w -e DD_API_KEY -e DD_APP_KEY datadog/ci <command> [<subcommand>] [options]
```

#### Building your own container image

You can build an image using the provided [Dockerfile](https://github.com/DataDog/datadog-ci/blob/master/container/Dockerfile):

```sh
cd container
docker build --tag datadog-ci .
```

Optionally, you can use the `VERSION` build argument to build an image for a specific version:

```sh
docker build --build-arg "VERSION=v3.9.0" --tag datadog-ci .
```

## Migration guide

If you are upgrading from a previous major version, read our [MIGRATING.md](MIGRATING.md) document to understand the changes and how to adapt your scripts.

## Development

Before contributing to this open source project, read our [CONTRIBUTING.md](CONTRIBUTING.md) document.

## License

[Apache License, v2.0](LICENSE)
