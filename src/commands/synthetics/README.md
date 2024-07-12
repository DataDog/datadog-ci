<div class="alert alert-info">This page is about configuring Continuous Testing tests for your Continuous Integration (CI) and Continuous Delivery (CD) pipelines. If you want to bring your CI/CD metrics and data into Datadog dashboards, see the <a href="https://docs.datadoghq.com/continuous_integration/" target="_blank">CI Visibility</a> section.</div>

## Overview

Use the [`@datadog-ci` NPM package][1] to run Continuous Testing tests directly within your CI/CD pipeline. You can automatically halt a build, block a deployment, and roll back a deployment when a Synthetic browser test detects a regression. 

To configure which URL your test starts on, provide a `startUrl` to your test object. Build your own starting URL with any part of your test's original starting URL and include environment variables.

## Setup

### Install the package

<!-- xxx tabs xxx -->
<!-- xxx tab "NPM" xxx -->

Install the package through NPM:

```bash
npm install --save-dev @datadog/datadog-ci
```

<!-- xxz tab xxx -->
<!-- xxx tab "Yarn" xxx -->

Install the package through Yarn:

```bash
yarn add --dev @datadog/datadog-ci
```

<!-- xxz tab xxx -->
<!-- xxz tabs xxx -->

### Setup the client

To setup the client, your Datadog API and application keys need to be configured. These keys can be defined in three different ways:

1. Defined in a [global JSON configuration file](#global-configuration-file-options):

    ```json
    {
      "apiKey": "<API_KEY>",
      "appKey": "<APPLICATION_KEY>",
    }
    ```

2. Defined as environment variables:

    ```bash
    export DATADOG_API_KEY="<API_KEY>"
    export DATADOG_APP_KEY="<APPLICATION_KEY>"
    ```

3. Passed to the CLI when running your tests:

    ```bash
    yarn datadog-ci synthetics run-tests --apiKey "<API_KEY>" --appKey "<APPLICATION_KEY>"
    ```

### Global configuration file options

Using a global configuration file is one of the ways to configure datadog-ci. To do so, create a JSON configuration file on your system. Specify the path to the file using the `--config` flag [when launching your tests](#run-tests-command) or [uploading a new application](#upload-application-command). If you don't specify a file path, Datadog looks for a file with the default filename of `datadog-ci.json`.

See each command's list of configurations below for the list of advanced options in the global configuration file relevant to each [run-tests command](#list-of-configurations) and [upload-application command](#list-of-configurations-1). For an example configuration file, see this [`example-global-config.json` file][9].

### Configuring with Environment Variables

In addition to the global configuration file and CLI arguments, you can configure all properties using environment variables.

### Command line options

### API

By default, `datadog-ci` runs at the root of the working directory and looks for `{,!(node_modules)/**/}*.synthetics.json` files (every file ending with `.synthetics.json`, except for those in the `node_modules` folder) to find a [test configuration file](#test-files).
The default file name for the [global configuration file](#global-configuration-file-options) is `datadog-ci.json`. If you use this name for your global configuration file, you may omit the `--config` flag.

For example:

```jsonc
{
  "apiKey": "<DATADOG_API_KEY>",
  "appKey": "<DATADOG_APPLICATION_KEY>",
  "batchTimeout": 180000,
  "datadogSite": "datadoghq.com", // You can use another Datadog site in https://docs.datadoghq.com/getting_started/site/. By default, requests are sent to Datadog US1. 
  "defaultTestOverrides": {
    "allowInsecureCertificates": true,
    "basicAuth": {"username": "test", "password": "test"},
    "body": "{\"fakeContent\":true}",
    "bodyType": "application/json",
    "cookies": "name1=value1;name2=value2;",
    "defaultStepTimeout": 15,
    "deviceIds": ["chrome.laptop_large"],
    "executionRule": "skipped",
    "followRedirects": true,
    "headers": {"NEW_HEADER": "NEW VALUE"},
    "locations": ["aws:us-east-1"],
    "mobileApplicationVersion": "01234567-8888-9999-abcd-efffffffffff",
    "mobileApplicationVersionFilePath": "path/to/application.apk",
    "retry": {"count": 2, "interval": 300},
    "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
    "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
    "testTimeout": 300,
    "variables": {"NEW_VARIABLE": "NEW VARIABLE"}
  },
  "failOnCriticalErrors": true,
  "failOnMissingTests": true,
  "failOnTimeout": true,
  "files": ["{,!(node_modules)/**/}*.synthetics.json"],
  "proxy": {
    "auth": {
      "username": "login",
      "password": "pwd"
    },
    "host": "127.0.0.1",
    "port": 3128,
    "protocol": "http"
  },
  "subdomain": "subdomainname",
  "tunnel": true
}
```

**Note**: The `global` field from the global configuration file is deprecated in favor of `defaultTestOverrides`.

### Use a proxy

It is possible to configure a proxy to be used for outgoing connections to Datadog using the `proxy` key of the global configuration file.

As the [`proxy-agent` library][2] is used to configure the proxy, the supported protocols include `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The `proxy` key of the global configuration file is passed to a new `proxy-agent` instance, which means the same configuration for the library is supported.

**Note**: `host` and `port` keys are mandatory arguments and the `protocol` key defaults to `http` if not defined.

For example:

```jsonc
{
  "apiKey": "<DATADOG_API_KEY>",
  "appKey": "<DATADOG_APPLICATION_KEY>",
  "proxy": {
    "auth": {
      "username": "login",
      "password": "pwd"
    },
    "host": "127.0.0.1",
    "port": 3128,
    "protocol": "http"
  }
}
```

**Note**: The `global` field from the global configuration file is deprecated in favor of `defaultTestOverrides`.

## Run Tests Command

You can decide to have the CLI auto-discover all your `**/*.synthetics.json` Synthetic tests (or all the tests associated to the path specified in your [global configuration file](#global-configuration-file-options)) or specify the tests you want to run using the `-p,--public-id` flag.

<!-- xxx tabs xxx -->
<!-- xxx tab "NPM" xxx -->

Run tests by executing the CLI through **NPM**:

Add the following to your `package.json`:

```json
{
  "scripts": {
    "datadog-ci-synthetics": "datadog-ci synthetics run-tests"
  }
}
```

Then, run:

```bash
npm run datadog-ci-synthetics
```

**Note**: If you are launching your tests with a custom global configuration file, append the command associated to your `datadog-ci-synthetics` script with `--config <PATH_TO_GLOBAL_CONFIG_FILE>`.

<!-- xxz tab xxx -->
<!-- xxx tab "Yarn" xxx -->

Run tests by executing the CLI through **Yarn**:

The `run-tests` sub-command runs the tests discovered in the folder according to the `files` configuration key. It accepts the `--public-id` (or shorthand `-p`) argument to trigger only the specified test. It can be set multiple times to run multiple tests:

```bash
yarn datadog-ci synthetics run-tests --public-id pub-lic-id1 --public-id pub-lic-id2
```

It is also possible to trigger tests corresponding to a search query by using the flag `--search` (or shorthand `-s`). With this option, the overrides defined in your [global configuration file](#global-configuration-file-options) apply to all tests discovered with the search query.

```bash
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests'
```

You can use `--files` (shorthand `-f`) to override the default glob pattern (which would match all `**/*.synthetics.json` files) when you want to discover only a subset of the tests.

```bash
yarn datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json
```

**Note**: If you are launching your tests with a custom global configuration file, append your command with `--config <PATH_TO_GLOBAL_CONFIG_FILE>`.

<!-- xxz tab xxx -->
<!-- xxz tabs xxx -->

### List of Configurations

<!--
  The descriptions of these is kept for consistency in this doc - https://datadoghq.atlassian.net/wiki/spaces/SYN/pages/3378446383/Configuration+parameters+and+their+usages#Proposal-for-aligning-Descriptions-and-labels
  If want to update them please update the doc and the relevant integrations as well.
-->

#### `apiKey`

The API key used to query the Datadog API.

* Global Config: `"apiKey": "<API_KEY>"`
* ENV variable: `DATADOG_API_KEY="<API_KEY>"`
* CLI param: `--apiKey "<API_KEY>"`

#### `appKey`

The application key used to query the Datadog API.

* Global Config: `"appKey": "<APPLICATION_KEY>"`
* ENV variable: `DATADOG_APP_KEY="<APPLICATION_KEY>"`
* CLI param: `--appKey "<APPLICATION_KEY>"`

#### `batchTimeout`

The duration (integer in milliseconds) after which `datadog-ci` stops waiting for test results. The default is 30 minutes. At the CI level, test results completed after this duration are considered failed.

* Global Config: `"batchTimeout": 180000`
* ENV variable: `DATADOG_SYNTHETICS_BATCH_TIMEOUT=180000`
* CLI param: `--batchTimeout 180000`

#### `configPath`

The global JSON configuration is used when launching tests. See the [example configuration](https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration/?tab=npm#global-configuration-file-options ) for more details.

* Global Config: N/A
* ENV variable: `DATADOG_SYNTHETICS_CONFIG_PATH=global-config.json`
* CLI param: `--config global-config.json`

#### `datadogSite`

The Datadog instance to which request is sent. The default is `datadoghq.com`.<!-- partial Your Datadog site is {{< region-param key="dd_site" code="true" >}}. partial -->

* Global Config: `"datadogSite": "datadoghq.com"`
* ENV variable: `DATADOG_SITE=datadoghq.com`
* CLI param: `--datadogSite datadoghq.com`

#### `defaultTestOverrides`

Overrides for Synthetic tests applied to all tests.

* Global Config: See `testOverrides` part of [Test files](#test-files) for an example.
* ENV variable: N/A
* CLI param: N/A

#### `failOnCriticalErrors`

A boolean flag that fails the CI job if no tests were triggered, or results could not be fetched from Datadog. The default is set to `false`.

* Global Config: `"failOnCriticalErrors": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS=true`
* CLI param: `--failOnCriticalErrors`

#### `failOnMissingTests`

A boolean flag that fails the CI job if at least one specified test with a public ID (a `--public-id` CLI argument or listed in a [test file](#test-files)) is missing in a run (for example, if it has been deleted programmatically or on the Datadog site). The default is set to `false`.

* Global Config: `"failOnMissingTests": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS=true`
* CLI param: `--failOnMissingTests`

#### `failOnTimeout`

A boolean flag that fails the CI job if at least one test exceeds the default test timeout. The default is set to `true`.

* Global Config: `"failOnTimeout": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT=true`
* CLI param: `--failOnTimeout`

#### `files`

Glob patterns to detect Synthetic test [configuration files](#test-files).

* Global Config: `"files": ["{,!(node_modules)/**/}*.synthetics.json"]`
* ENV variable: `DATADOG_SYNTHETICS_FILES="{,!(node_modules)/**/}*.synthetics.json"`
* CLI param: `-f "{,!(node_modules)/**/}*.synthetics.json"` / `--files "{,!(node_modules)/**/}*.synthetics.json"`

#### `jUnitReport`

The filename for a JUnit report if you want to generate one.

* Global Config: `"jUnitReport": "e2e-test-junit"`
* ENV variable: `DATADOG_SYNTHETICS_JUNIT_REPORT="e2e-test-junit"`
* CLI param:`-j "e2e-test-junit"` / `--jUnitReport "e2e-test-junit"`

#### `mobileApplicationVersionFilePath`

Override the application version for all Synthetic mobile application tests.

* Global Config: `"mobileApplicationVersionFilePath": "path/to/application.apk"`
* ENV variable: Not Available
* CLI param: `--mobileApp "path/to/application.apk"` / `--mobileApplicationVersionFilePath "path/to/application.apk"`

#### `proxy`

The proxy to be used for outgoing connections to Datadog. `host` and `port` keys are mandatory arguments, the `protocol` key defaults to `http`. Supported values for the `protocol` key are `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The library used to configure the proxy is the [proxy-agent][2] library.

* Global Config: See [Use a proxy](#use-a-proxy) for an example.
* ENV variable: N/A
* CLI param: N/A

#### `publicIds`

List of IDs for the Synthetic tests you want to trigger.

* Global Config: `"publicIds": ["abc-def-ghi", "123-456-789"]`
* ENV variable: `DATADOG_SYNTHETICS_PUBLIC_IDS="abc-def-ghi;123-456-789"`
* CLI param: `-p "abc-def-ghi" --public-id "123-456-789"`

#### `selectiveRerun`

A boolean flag to only run the tests which failed in the previous test batches. Use the `--no-selectiveRerun` CLI flag to force a full run if your configuration enables it by default.

* Global Config: `"selectiveRerun": true,`
* ENV variable: `DATADOG_SYNTHETICS_SELECTIVE_RERUN=true`
* CLI param: `--selectiveRerun`

#### `subdomain`

The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.

* Global Config: `"subdomain": "myorg"`
* ENV variable: `DATADOG_SUBDOMAIN="myorg"`
* CLI param: `--subdomain "myorg"`

#### `testSearchQuery`

Pass a query to select which Synthetic tests to run. If you are running tests in the CLI, use the `-s` flag.

* Global Config: `"testSearchQuery": "tag:e2e-tests"`
* ENV variable: `DATADOG_SYNTHETICS_TEST_SEARCH_QUERY="tag:e2e-tests"`
* CLI param: `-s "tag:e2e-tests"` / `--search "tag:e2e-tests"`

#### `tunnel`

Use [Local and Staging Environments](#use-local-and-staging-environments) to execute your test batch.

* Global Config: `"tunnel": true`
* ENV variable: `DATADOG_SYNTHETICS_TUNNEL=true`
* CLI param: `-t` / `--tunnel`

**Note**: The `pollingTimeout` option and `--pollingTimeout` CLI parameter are deprecated in favor of `batchTimeout` and `--batchTimeout`, respectively.

### Failure modes flags

- `--failOnTimeout` (or `--no-failOnTimeout`) makes the CI fail (or pass) if one of the results exceeds its test timeout.
- `--failOnCriticalErrors` makes the CI fail if tests were not triggered or if results could not be fetched.
- `--failOnMissingTests` makes the CI fail if at least one specified test with a public ID (a `--public-id` CLI argument or listed in a test file) is missing in a run (for example, if it has been deleted programmatically or on the Datadog site).

### Configure a custom subdomain

If the organization uses a custom sub-domain to access Datadog, this needs to be set in the `DATADOG_SUBDOMAIN` environment variable or in the global configuration file under the `subdomain` key in order to properly display the test results URL.

For example, if the URL used to access Datadog is `myorg.datadoghq.com`, set the environment variable to `myorg`:

```bash
export DATADOG_SUBDOMAIN="myorg"
```

### Configure custom locations

You can use `DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS` to override the locations where your tests run. Locations should be separated with `;`. The configuration in [test files](#test-files) takes precedence over other overrides.

```bash
export DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS="aws:us-east-1;aws:us-east-2"
```

**Note** The env variable `DATADOG_SYNTHETICS_LOCATIONS` has been deprecated in favour of `DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS`


### Test files

Your test files must be named with a `.synthetics.json` suffix. 

```jsonc
// myTest.synthetics.json
{
  "tests": [
    {
      "id": "<TEST_PUBLIC_ID>",
      "testOverrides": {
        "allowInsecureCertificates": true,
        "basicAuth": {"username": "test", "password": "test"},
        "body": "{\"fakeContent\":true}",
        "bodyType": "application/json",
        "cookies": "name1=value1;name2=value2;",
        "defaultStepTimeout": 15,
        "deviceIds": ["chrome.laptop_large"],
        "executionRule": "skipped",
        "followRedirects": true,
        "headers": {"NEW_HEADER": "NEW VALUE"},
        "locations": ["aws:us-east-1"],
        "mobileApplicationVersion": "01234567-8888-9999-abcd-efffffffffff",
        "mobileApplicationVersionFilePath": "path/to/application.apk",
        "retry": {"count": 2, "interval": 300},
        "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
        "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
        "testTimeout": 300,
        "variables": {"MY_VARIABLE": "new title"}
      }
    }
  ]
}
```
**Note**: The `config` field from the global configuration file is deprecated in favor of `testOverrides`.

The `<TEST_PUBLIC_ID>` can be either the identifier of the test found in the URL of a test details page (for example, for `https://app.datadoghq.com/synthetics/details/abc-def-ghi`, it would be `abc-def-ghi`) or the full URL to the details page (for example, directly `https://app.datadoghq.com/synthetics/details/abc-def-ghi`).

All options under the `testOverrides` key are optional and allow overriding of the test configuration as stored in Datadog. These options can also be set with environment variables starting with `DATADOG_SYNTHETICS_OVERRIDE_`, or with the `--override` CLI parameter following this pattern: `--override option=value`.

| Options                            | Type             | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowInsecureCertificates`        | Boolean          | Disable certificate checks in Synthetic API and Browser tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `basicAuth`                        | Object           | Credentials to provide if basic authentication is required.<br><br>- `username` (String): The username for basic authentication.<br>- `password` (String): The password for basic authentication.<br><br>  With `--override`, use `basicAuth.username` and `basicAuth.password`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `body`                             | String           | Data to send in an API test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `bodyType`                         | String           | Content type for the data to send in an API test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `cookies`                          | String or object | Use the provided string as a cookie header in an API or browser test (in addition or as a replacement).<br><br>- If this is a string, it is used to replace the original cookies.<br>- If this is an object, the format must be `{append?: boolean, value: string}`, and depending on the value of `append`, it is appended or replaces the original cookies. <br><br> With `--override`, use `cookies` and `cookies.append`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `defaultStepTimeout`               | Number           | The maximum duration of steps in seconds for browser tests, which does not override individually set step timeouts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `deviceIds`                        | Array            | A list of devices to run the browser test on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `executionRule`                    | String           | The execution rule for the test defines the behavior of the CLI in case of a failing test.<br><br>- `blocking`: The CLI returns an error if the test fails.<br>- `non_blocking`: The CLI only prints a warning if the test fails.<br>- `skipped`: The test is not executed at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `followRedirects`                  | Boolean          | Indicates whether or not to follow HTTP redirections in Synthetic API tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `headers`                          | Object           | The headers to replace in the test. This object should contain keys as the name of the header to replace and values as the new value of the header to replace. <br><br> With `--override`, use `headers.<YOUR_HEADER>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `locations`                        | Array            | A list of locations to run the test from.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `mobileApplicationVersion`         | String           | Override the default mobile application version for a Synthetic mobile application test. The version must be uploaded and available within Datadog.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `mobileApplicationVersionFilePath` | String           | Override the application version for a Synthetic mobile application test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `retry`                            | Object           | The retry policy for the test.<br><br>- `count` (Integer): The number of attempts to perform in case of test failure.<br>- `interval` (Integer): The interval between attempts in milliseconds. <br><br> With `--override`, use `retry.count` and `retry.interval`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `startUrl`                         | String           | The new start URL to provide to the test. Variables specified in brackets (for example, `{{ EXAMPLE }}`) found in environment variables are replaced.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `startUrlSubstitutionRegex`        | String           | The regex to modify the starting URL of the test (for browser and HTTP tests only), whether it was given by the original test or the configuration override `startUrl`. <br><br>If the URL contains variables, this regex applies after the interpolation of the variables. <br><br>There are two possible formats: <br><br>- `your_regex\|your_substitution`: The pipe-based syntax, to avoid any conflicts with `/` characters in URLs. For example, `https://example.com(.*)\|http://subdomain.example.com$1` to transform `https://example.com/test` to `http://subdomain.example.com/test`. <br>- `s/your_regex/your_substitution/modifiers`: The slash syntax, which supports modifiers. For example, `s/(https://www.)(.*)/$1extra-$2/` to transform `https://www.example.com` into `https://www.extra-example.com`. |
| `testTimeout`                      | Number           | The maximum duration of a browser test in seconds.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `variables`                        | Object           | The variables to replace in the test. This object should contain key as the name of the variable to replace and values as the new value of the variable to replace. <br><br> With `--override`, use `variables.NAME=VALUE`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

**Note**: The `pollingTimeout` option is deprecated in favor of `batchTimeout` in the global configuration file, or the `--batchTimeout` CLI parameter.

## Use local and staging environments

You can combine variable overrides with [Local and Staging Environments][3] to run tests within your development environment. This connection ensures that all test requests sent through the CLI are automatically routed through the `datadog-ci` client. 

This allows you to run tests with end-to-end encryption at every stage of your software development lifecycle, from pre-production environments to your production system.

## End-to-end testing process

To verify the Synthetics command works as expected, trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API_KEY>'
export DATADOG_APP_KEY='<APPLICATION_KEY>'

yarn datadog-ci synthetics run-tests --public-id abc-def-ghi
```

Successful output should look like this:

```bash
[abc-def-ghi] Trigger test "Check on testing.website"
[abc-def-ghi] Waiting results for "Check on testing.website"


=== REPORT ===
Took 11546ms

✓ [abc-def-ghi] | Check on testing.website
  ✓ location: Frankfurt (AWS)
    ⎋  total duration: 28.9 ms - result url: https://app.datadoghq.com/synthetics/details/abc-def-ghi?resultId=123456789123456789
    ✓ GET - https://testing.website
```

### Reporters

Two reporters are supported out-of-the-box:

1. `stdout`
2. JUnit

To enable the JUnit report, pass the `--jUnitReport` (`-j` shorthand) in your command, specifying a filename for your JUnit XML report.

```bash
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests' --config global-config.json --jUnitReport e2e-test-junit
```

Reporters can hook themselves into the `MainReporter` of the command.

### Available hooks

| Hook name        | Parameters                                                                               | Description                                                     |
| :--------------- | :--------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `log`            | `(log: string)`                                                                          | Called for logging.                                             |
| `error`          | `(error: string)`                                                                        | Called whenever an error occurs.                                |
| `initErrors`     | `(errors: string[])`                                                                     | Called whenever an error occurs during the tests parsing phase. |
| `testTrigger`    | `(test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride)` | Called when a test is triggered.                                |
| `testWait`       | `(test: Test)`                                                                           | Called when a test is waiting to receive its results.           |
| `testsWait`      | `(tests: Test[], baseUrl: string, batchId: string, skippedCount?: number)`               | Called when all tests are waiting to receive their results.     |
| `resultReceived` | `(result: ResultInBatch)`                                                                | Called when a result is received.                               |
| `resultEnd`      | `(result: Result, baseUrl: string)`                                                      | Called for each result at the end of all results.               |
| `reportStart`    | `(timings: {startTime: number})`                                                         | Called at the start of the report.                              |
| `runEnd`         | `(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings)`               | Called at the end of the run.                                   |

## View test results

You can see results for CI batches by clicking on a batch in the [Synthetic Monitoring & Testing Results Explorer][4] or clicking on a test on the [**Tests** page][5].

You can also see the outcome of test executions directly in your CI as your tests are being executed. To identify what caused a test to fail, look at the execution logs and search for causes of the failed assertion.

```bash
  yarn datadog-ci synthetics run-tests --config global-config.json
  yarn run v1.22.4
  $ /Users/demo.user/go/src/github.com/Datadog/tmp/test/testDemo/node_modules/.bin/datadog-ci synthetics run-tests --config global-config.json
  Finding files matching /Users/demo.user/go/src/github.com/Datadog/tmp/test/testDemo/{,!(node_modules)/**/}*.synthetics.json

  Got test files:
    - user.synthetics.json

  [2cj-h3c-39x] Trigger test "Test CI connection"
  [2cj-h3c-39x] Waiting results for "Test CI connection"

  === REPORT ===
  Took 2242ms

  x  [2cj-h3c-39x] | Test CI connection
    * location: 30019
      ⎋ total duration: 32.6 ms - result url: https://app.datadoghq.com/synthetics/details/2cj-h3c-39x?resultId=122140688175981634
      x GET - https://www.datadoghq.com
        [INCORRECT_ASSUMPTION] - [{"index":1,"operator":"is","property":"content-type","type":"header","target":"text/html","valid":false,"actual":"text/html"; charset=utf-8"}] 
  error Command failed with exit code 1.
  info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
```

## Upload Application Command

This command uploads a new version to an **existing** mobile application.

### List of Configurations

<!--
  The descriptions of these is kept for consistency in this doc - https://datadoghq.atlassian.net/wiki/spaces/SYN/pages/3378446383/Configuration+parameters+and+their+usages#Proposal-for-aligning-Descriptions-and-labels
  If want to update them please update the doc and the relevant integrations as well.
-->

#### `apiKey`

The API key used to query the Datadog API.

* Global Config: `"apiKey": "<API_KEY>"`
* ENV variable: `DATADOG_API_KEY="<API_KEY>"`
* CLI param: `--apiKey "<API_KEY>"`

#### `appKey`

The application key used to query the Datadog API.

* Global Config: `"appKey": "<APPLICATION_KEY>"`
* ENV variable: `DATADOG_APP_KEY="<APPLICATION_KEY>"`
* CLI param: `--appKey "<APPLICATION_KEY>"`

#### `configPath`

The global JSON configuration is used when launching tests. See the [example configuration](https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration/?tab=npm#global-configuration-file-options ) for more details.

* Global Config: N/A
* ENV variable: `DATADOG_SYNTHETICS_CONFIG_PATH=global-config.json`
* CLI param: `--config global-config.json`

#### `datadogSite`

The Datadog instance to which request is sent. The default is `datadoghq.com`.<!-- partial Your Datadog site is {{< region-param key="dd_site" code="true" >}}. partial -->

* Global Config: `"datadogSite": "datadoghq.com"`
* ENV variable: `DATADOG_SITE=datadoghq.com`
* CLI param: `--datadogSite datadoghq.com`

#### `latest`

If present, marks the application as 'latest'. Any tests that run on the latest version will use this version on their next run.

* Global Config: `"latest": true,`
* ENV variable:  `DATADOG_SYNTHETICS_LATEST=true`
* CLI param: `--latest`

#### `mobileApplicationId`

The ID of the application you want to upload the new version to.

* Global Config: `"mobileApplicationId": "123-123-123"`
* ENV variable: `DATADOG_SYNTHETICS_MOBILE_APPLICATION_ID=123-123-123`
* CLI param: `--mobileApplicationId 123-123-123`

#### `mobileApplicationVersionFilePath`

The path to your mobile application (`.apk` or `.ipa`).

* Global Config: `"mobileApplicationVersionFilePath": example/test.apk`
* ENV variable: Not Available
* CLI param: `--mobileApplicationVersionFilePath example/test.apk`

#### `proxy`

The proxy to be used for outgoing connections to Datadog. `host` and `port` keys are mandatory arguments, the `protocol` key defaults to `http`. Supported values for the `protocol` key are `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The library used to configure the proxy is the [proxy-agent][2] library.

* Global Config: See [Use a proxy](#use-a-proxy) for an example.
* ENV variable: N/A
* CLI param: N/A

#### `versionName`

The name of the new version. It has to be unique.

* Global Config: `"versionName": "example"`
* ENV variable: `DATADOG_SYNTHETICS_VERSION_NAME=example`
* CLI param: `--versionName example`

Example:

```bash
datadog-ci synthetics upload-application                \
  --mobileApplicationId '123-123-123'                   \
  --mobileApplicationVersionFilePath example/test.apk   \
  --versionName 'example 1.0'                           \
  --latest
```

### Using the global configuration file

You can also pass these options in a configuration file:

```json
{
  "apiKey": "<DATADOG_API_KEY>",
  "appKey": "<DATADOG_APPLICATION_KEY>",
  "mobileApplicationVersionFilePath": "example_path/example_app.apk",
  "mobileApplicationId": "example-abc",
  "versionName": "example",
  "latest": true
}
```

These options can also be added to the same global configuration file used for the run-tests command.

Pass this config file to the command with the `--config` flag:

```bash
datadog-ci synthetics upload-application --config global-config.json
```

The default file name for the [global configuration file](#global-configuration-file-options) is `datadog-ci.json`. If you use this name for your global configuration file, you may omit the `--config` flag.

## Further reading

Additional helpful documentation, links, and articles:

- [Use Datadog's GitHub Action to add continuous testing to your workflows][6]
- [Learn about Continuous Testing and CI/CD][7]
- [Learn about Mobile Application Testing][10]
- [Learn about the Synthetic Monitoring & Testing Results Explorer][8]
- [Learn about Testing Local and Staging Environments][3]

[1]: https://www.npmjs.com/package/@datadog/datadog-ci
[2]: https://github.com/TooTallNate/node-proxy-agent
[3]: https://docs.datadoghq.com/continuous_testing/environments/
[4]: https://app.datadoghq.com/synthetics/explorer/
[5]: https://app.datadoghq.com/synthetics/tests
[6]: https://www.datadoghq.com/blog/datadog-github-action-synthetics-ci-visibility/
[7]: https://docs.datadoghq.com/continuous_testing/cicd_integrations/
[8]: https://docs.datadoghq.com/continuous_testing/explorer/
[9]: https://github.com/DataDog/datadog-ci/blob/master/.github/workflows/e2e/example-global-config.json
[10]: https://docs.datadoghq.com/mobile_app_testing/

<!--
  This page is single-sourced:
  https://github.com/DataDog/documentation/blob/7007931530baf7da59310e7224a26dc9a71c53c5/local/bin/py/build/configurations/pull_config_preview.yaml#L315
->
