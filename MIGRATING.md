# Migrating

This guide describes the steps to upgrade datadog-ci from a major version to the next.
If you are having any issues related to migrating, please feel free to open an issue or contact our [support](https://www.datadoghq.com/support/) team.

## 4.0 to 5.0

### Node 18 is no longer supported

Node.js 18 has reached EOL in April 2025.
Generally speaking, we highly recommend always keeping Node.js up to date regardless of our support policy.

### SBOM upload no longer supports pull request triggers

The `sbom upload` command no longer supports pull request triggers in CI platforms. This affects:

- **GitHub Actions**: The `pull_request` event is not supported.
- **GitLab CI**: The `merge_request_event` pipeline source is not supported.
- **Azure Pipelines**: The `PullRequest` build reason is not supported.

**Migration**: Configure your CI workflow to use `push` instead. See the [documentation](https://docs.datadoghq.com/security/code_security/static_analysis/github_actions/#workflow) for more information.

### Default values for `lambda instrument` command

The `--layer-version` and `--extension-version` CLI parameters now default to `latest` instead of `none`. (https://github.com/DataDog/datadog-ci/pull/2012)

**Migration**: To keep the previous behavior, explicitly add `--layer-version none --extension-version none`.

### Plugin updates

In 5.0, we moved the `synthetics` commands into the `@datadog/datadog-ci-plugin-synthetics` plugin.

| Moved commands                                                                   | Destination plugin                      |
| -------------------------------------------------------------------------------- | --------------------------------------- |
| <ul><li>`synthetics run-tests`</li><li>`synthetics upload-application`</li></ul> | `@datadog/datadog-ci-plugin-synthetics` |

By default, running a command that requires a plugin will **automatically install the plugin** if it is not already installed. You can disable this behavior with `DISABLE_PLUGIN_AUTO_INSTALL=1`.

More information in the [README](/#installing-a-plugin).

## 3.0 to 4.0

### SARIF upload no longer supports pull request triggers

The `sarif upload` command no longer supports pull request triggers in CI platforms. This affects:

- **GitHub Actions**: The `pull_request` event is not supported.
- **GitLab CI**: The `merge_request_event` pipeline source is not supported.
- **Azure Pipelines**: The `PullRequest` build reason is not supported.

**Migration**: Configure your CI workflow to use `push` instead. See the [documentation](https://docs.datadoghq.com/security/code_security/static_analysis/github_actions/#workflow) for more information.

### New: Plugins

In 4.0, we moved some commands into plugins to reduce the size of the `@datadog/datadog-ci` package:

| Moved commands                                                                                      | Destination plugin                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| <ul><li>`aas instrument`</li><li>`aas uninstrument`</li></ul>                                       | `@datadog/datadog-ci-plugin-aas`           |
| <ul><li>`cloud-run flare`</li><li>`cloud-run instrument`</li><li>`cloud-run uninstrument`</li></ul> | `@datadog/datadog-ci-plugin-cloud-run`     |
| <ul><li>`lambda flare`</li><li>`lambda instrument`</li><li>`lambda uninstrument`</li></ul>          | `@datadog/datadog-ci-plugin-lambda`        |
| <ul><li>`stepfunctions instrument`</li><li>`stepfunctions uninstrument`</li></ul>                   | `@datadog/datadog-ci-plugin-stepfunctions` |

By default, running a command that requires a plugin will **automatically install the plugin** if it is not already installed. You can disable this behavior with `DISABLE_PLUGIN_AUTO_INSTALL=1`.

More information in the [README](/#installing-a-plugin).

### Library API changes

- Use `import * as synthetics from '@datadog/datadog-ci-plugin-synthetics'` instead of `import {synthetics} from '@datadog/datadog-ci'`.

## 2.0 to 3.0

### Node 14 and 16 are no longer supported

Node.js 14 has reached EOL in April 2023, and Node.js 16 in September 2023.
Generally speaking, we highly recommend always keeping Node.js up to date regardless of our support policy.

### CLI changes

This major version cleans up most deprecated CLI parameters, options and environment variables. Here is a summary by command.

#### `git-metadata upload` command

- The deprecated `--git-sync` CLI parameter is removed as it's now the default behavior.
  - Use `--no-git-sync` to disable it.

#### `measure` and `junit upload` commands

- The `--metrics`, `--report-metrics` CLI parameters and `DD_METRICS` environment variable are removed.
  - Use `--measures`, `--report-measures` and `DD_MEASURES` instead.

#### `synthetics run-tests` command

##### Configuration structure

- The `global` field in the global configuration file (e.g. `datadog-ci.json`) is removed.
  - Use [`defaultTestOverrides`](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#defaulttestoverrides) instead.
- The `config` field in test configuration files (e.g. `*.synthetics.json`) is removed.
  - Use [`testOverrides`](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#test-files) instead.

##### Files

More information [in the documentation](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#files).

- The `files` option in the global configuration file does not support simple strings anymore.
  - Use an array of strings instead, i.e. `"files": ["{,!(node_modules)/**/}*.synthetics.json"]`.

##### Polling timeout

More information [in the documentation](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#batchtimeout).

- The `--pollingTimeout` CLI parameter is removed.
  - Use `--batchTimeout` instead.
- The `pollingTimeout` option in the global configuration file is removed.
  - Use `batchTimeout` instead.
- The `pollingTimeout` option in test configuration files is removed.
  - If you want to set specific test-level timeouts, use [`testTimeout`](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#testtimeout-number). Otherwise, set a batch-level timeout with `batchTimeout`.

##### Locations

More information [in the documentation](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#locations-array).

- The `--locations` CLI parameter is removed.
  - Use `--override locations="location1;location2"` instead.
- The `locations` option in the global configuration file is removed.
  - Set `locations` in test overrides instead (i.e. in `defaultTestOverrides` or `testOverrides`).
- The `DATADOG_SYNTHETICS_LOCATIONS` environment variable is removed.
  - Use `DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS` instead.

##### Variables

More information [in the documentation](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#variables-object).

- The `--variable` CLI parameter is removed.
  - Use `--override variables.NAME=VALUE` instead.
- The `variableStrings` option in the global configuration file is removed.
  - Set `variables` in test overrides instead (i.e. in `defaultTestOverrides` or `testOverrides`).

##### Device IDs

More information [in the documentation](https://github.com/DataDog/datadog-ci/blob/master/packages/plugin-synthetics/README.md#deviceids-array).

- The `--deviceIds` CLI parameter is removed.
  - Use `--override deviceIds="device1;device2"` instead.

### Library API changes

In this major version, there are a few breaking changes in the exported `synthetics.utils` that can be used programmatically by importing datadog-ci as a NPM library:

- `hasResultPassed()` is removed and has no replacement.
  - The status is available in `Result.status` for each result in a batch.
- `getResultDuration()` is removed and has no replacement.
  - The duration is available in `Result.duration` for each result in a batch.
- `getOverriddenConfig()` is removed.
  - Use `makeTestPayload()` instead.
- Removed 4 functions that were exported but that needed an instance of `APIHelper` as parameter, which had no exported constructor.
