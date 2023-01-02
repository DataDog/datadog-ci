<div class="alert alert-info">This page is about configuring Continuous Testing tests for your continuous integration (CI) and continuous delivery (CD) pipelines. If you want to bring your CI/CD metrics and data into Datadog dashboards, see the <a href="https://docs.datadoghq.com/continuous_integration/" target="_blank">CI Visibility</a> section.</div>

## Overview

Use the [`@datadog-ci` NPM package][1] to run Continuous Testing tests directly within your CI/CD pipeline. You can automatically halt a build, block a deployment, and roll back a deployment when a Synthetic browser test detects a regression. 

To configure which URL your test starts on, provide a `startUrl` to your test object. Build your own starting URL with any part of your test's original starting URL and include environment variables.

## Setup

### Install the package

#### NPM

Install the package through NPM:

```bash
npm install --save-dev @datadog/datadog-ci
```

#### Yarn

Install the package through Yarn:

```bash
yarn add --dev @datadog/datadog-ci
```

### Setup the client

To setup the client, your Datadog API and application keys need to be configured. These keys can be defined in three different ways:

1. Defined as environment variables:

   ```bash
   export DATADOG_API_KEY="<API_KEY>"
   export DATADOG_APP_KEY="<APPLICATION_KEY>"
   ```

2. Passed to the CLI when running your tests:

   ```bash
   yarn datadog-ci synthetics run-tests --apiKey "<API_KEY>" --appKey "<APPLICATION_KEY>"
   ```

3. Or defined in a [global JSON configuration file](#global-configuration-file-options):

   Specify the path to this file using the `--config` flag [when launching your tests](#run-tests). If you set the name of your global configuration file to `datadog-ci.json`, that name is the default.

### Global configuration file options

In the global configuration file, you can set the following advanced options: 

`apiKey`
: The API key used to query the Datadog API.

`appKey`
: The application key used to query the Datadog API.

`datadogSite`
: The Datadog instance to which request is sent. The default is `datadoghq.com`. Your Datadog site is {{< region-param key="dd_site" code="true" >}}.

`failOnCriticalErrors`
: A boolean flag that fails the CI job if no tests were triggered, or results could not be fetched from Datadog. The default is set to `false`.

`failOnMissingTests`
: A boolean flag that fails the CI job if at least one test is missing in a run (for example, if it has been removed or deleted). The default is set to `false`.

`failOnTimeout`
: A boolean flag that fails the CI job if at least one test exceeds the default test timeout. The default is set to `true`.

`files`
: Glob pattern to detect Synthetic tests configuration files.

`global`
: Overrides for Synthetic tests applied to all tests.

`pollingTimeout`
: **Type**: integer<br>
The duration (in milliseconds) after which `datadog-ci` stops polling for test results. The default is 30 minutes. At the CI level, test results completed after this duration are considered failed.

`proxy`
: The proxy to be used for outgoing connections to Datadog. `host` and `port` keys are mandatory arguments, the `protocol` key defaults to `http`. Supported values for the `protocol` key are `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The library used to configure the proxy is the [proxy-agent][2] library.

`subdomain`
: The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.

`tunnel`
: Use the [testing tunnel][3] to execute your test batch.

`testSearchQuery`
: Pass a query to select which Synthetic tests to run. If you are running tests in the CLI, use the `-s` flag.

#### Use a proxy

It is possible to configure a proxy to be used for outgoing connections to Datadog using the `proxy` key of the global configuration file.

As the [`proxy-agent` library][2] is used to configure the proxy, the supported protocols include `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The `proxy` key of the global configuration file is passed to a new `proxy-agent` instance, which means the same configuration for the library is supported.

**Note**: `host` and `port` keys are mandatory arguments and the `protocol` key defaults to `http` if not defined.

For example: 

{{< code-block lang="json" filename="Global Configuration File" disable_copy="false" collapsible="true" >}}
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "datadogSite": "datadoghq.com", // You can use another Datadog site. By default, requests are sent to Datadog US1. 
    "files": "{,!(node_modules)/**/}*.synthetics.json",
    "failOnCriticalErrors": false,
    "failOnMissingTests": false,
    "failOnTimeout": true,
    "global": {
        "allowInsecureCertificates": true,
        "basicAuth": { "username": "test", "password": "test" },
        "body": "{\"fakeContent\":true}",
        "bodyType": "application/json",
        "cookies": "name1=value1;name2=value2;",
        "deviceIds": ["laptop_large"],
        "followRedirects": true,
        "headers": { "<NEW_HEADER>": "<NEW_VALUE>" },
        "locations": ["aws:us-west-1"],
        "retry": { "count": 2, "interval": 300 },
        "executionRule": "blocking",
        "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
        "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
        "variables": { "titleVariable": "new value" },
        "pollingTimeout": 180000
    },
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
{{< /code-block >}}

### Command line options

If the organization uses a custom sub-domain to access Datadog, this needs to be set in the `DATADOG_SUBDOMAIN` environment variable or in the global configuration file under the `subdomain` key in order to properly display the test results URL. 

For example, if the URL used to access Datadog is `myorg.datadoghq.com`, set the environment variable to `myorg`:

```bash
export DATADOG_SUBDOMAIN="myorg"
```

You can use `DATADOG_SYNTHETICS_LOCATIONS` to override the locations where your tests run. Locations should be separated with `;`. The configuration in test files takes precedence over other overrides.

```bash
export DATADOG_SYNTHETICS_LOCATIONS="aws:us-east-1;aws:us-east-2"
```

### API

By default, `datadog-ci` runs at the root of the working directory and finds `{,!(node_modules)/**/}*.synthetics.json` files (every file ending with `.synthetics.json`, except for those in the `node_modules` folder). The tool loads `datadog-ci.json`, which can be overridden through the `--config` argument.

For example:

{{< code-block lang="json" filename="Configuration File" disable_copy="false" collapsible="true" >}}
{
  "apiKey": "<DATADOG_API_KEY>",
  "appKey": "<DATADOG_APPLICATION_KEY>",
  "datadogSite": "datadoghq.com",
  "failOnCriticalErrors": true,
  "failOnMissingTests": true,
  "failOnTimeout": true,
  "files": "{,!(node_modules)/**/}*.synthetics.json",
  "global": {
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
    "retry": {"count": 2, "interval": 300},
    "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
    "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
    "variables": {"NEW_VARIABLE": "NEW VARIABLE"},
    "pollingTimeout": 120000
  },
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
{{< /code-block >}}

## Run tests

You can decide to have the CLI auto-discover all your `**/*.synthetics.json` Synthetic tests (or all the tests associated to the path specified in your [global configuration file](#global-configuration-file-options)) or to specify the tests you want to run using the `-p,--public-id` flag.

Run tests by executing the CLI:

{{< tabs >}}
{{% tab "Yarn" %}}

The `run-tests` sub-command runs the tests discovered in the folder according to the `files` configuration key. It accepts the `--public-id` (or shorthand `-p`) argument to trigger only the specified test. It can be set multiple times to run multiple tests:

```bash
yarn datadog-ci synthetics run-tests --public-id pub-lic-id1 --public-id pub-lic-id2
```

It is also possible to trigger tests corresponding to a search query by using the flag `--search` (or shorthand `-s`). With this option, the global configuration overrides applies to all tests discovered with the search query.

```bash
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests' --config global.config.json
```

You can use `--files` (shorthand `-f`) to override the global file selector when you want to run multiple suites in parallel with a single global configuration file.

```bash
yarn datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json
```

You can also pass variables as arguments using `--variable KEY=VALUE`.

```bash
yarn datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json -v PASSWORD=$PASSWORD
```

**Note**: If you are launching your tests with a custom global configuration file, append your command with `--config <PATH_TO_GLOBAL_CONFIG_FILE`.

{{% /tab %}}
{{% tab "NPM" %}}

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

**Note**: If you are launching your tests with a custom global configuration file, append the command associated to your `datadog-ci-synthetics` script with `--config <PATH_TO_GLOBAL_CONFIG_FILE`.

{{% /tab %}}
{{< /tabs >}}

### Failure modes flags

- `--failOnTimeout` (or `--no-failOnTimeout`) makes the CI fail (or pass) if one of the results exceeds its test timeout.
- `--failOnCriticalErrors` makes the CI fail if tests were not triggered or if results could not be fetched.
- `--failOnMissingTests` makes the CI fail if at least one test is missing.

### Test files

Your test files must be named with a `.synthetics.json` suffix.

```json
// myTest.synthetics.json
{
  "tests": [
    {
      "id": "<TEST_PUBLIC_ID>",
      "config": {
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
        "pollingTimeout": 30000,
        "retry": {"count": 2, "interval": 300},
        "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
        "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
        "variables": {"MY_VARIABLE": "new title"}
      }
    }
  ]
}
```

The `<TEST_PUBLIC_ID>` can be either the identifier of the test found in the URL of a test details page (for example, for `https://app.datadoghq.com/synthetics/details/abc-def-ghi`, it would be `abc-def-ghi`) or the full URL to the details page (for example, directly `https://app.datadoghq.com/synthetics/details/abc-def-ghi`).

All options under the `config` key are optional and allow overriding of the test configuration as stored in Datadog.

| Options                     | Type             | Definition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
|-----------------------------|------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `allowInsecureCertificates` | Boolean          | Disable certificate checks in Synthetic API tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `basicAuth`                 | Object           | Credentials to provide if basic authentication is required.<br><br>- `username` (String): The username for basic authentication.<br>- `password` (String): The password for basic authentication.                                                                                                                                                                                                                                                                                                      |
| `body`                      | String           | Data to send in an API test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `bodyType`                  | String           | Type of data sent in an API test.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `cookies`                   | String or object | Use the provided string as a cookie header in an API or browser test (in addition or as a replacement).<br><br>- If this is a string, it is used to replace the original cookies.<br>- If this is an object, the format must be `{append?: boolean, value: string}`, and depending on the value of the `append`, it is appended or replaces the original cookies.                                                                                                                                      |
| `defaultStepTimeout`        | Number           | The maximum duration of steps in seconds for browser tests, which does not override individually set step timeouts.                                                                                                                                                                                                                                                                                                                                                                                    |
| `deviceIds`                 | Array            | A list of devices to run the browser test on.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `executionRule`             | String           | The execution rule for the test defines the behavior of the CLI in case of a failing test.<br><br>- `blocking`: The CLI returns an error if the test fails.<br>- `non_blocking`: The CLI only prints a warning if the test fails.<br>- `skipped`: The test is not executed at all.                                                                                                                                                                                                                     |
| `followRedirects`           | Boolean          | Indicates whether or not to follow HTTP redirections in Synthetic API tests.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `headers`                   | Object           | The headers to replace in the test. This object should contain keys as the name of the header to replace and values as the new value of the header to replace.                                                                                                                                                                                                                                                                                                                                         |
| `locations`                 | Array            | A list of locations to run the test from.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pollingTimeout`            | Integer          | The maximum duration in milliseconds of a test. If the execution exceeds this value, it is considered failed.                                                                                                                                                                                                                                                                                                                                                                                          |
| `retry`                     | Object           | The retry policy for the test.<br><br>- `count` (Integer): The number of attempts to perform in case of test failure.<br>- `interval` (Integer): The interval between attempts in milliseconds.                                                                                                                                                                                                                                                                                                        |
| `startUrl`                  | String           | The new start URL to provide to the test. Variables specified in brackets (for example, `{{ EXAMPLE }}`) found in environment variables are replaced.                                                                                                                                                                                                                                                                                                                                                  |
| `startUrlSubstitutionRegex` | String           | The regex to modify the starting URL of the test (for browser and HTTP tests only), whether it was given by the original test or the configuration override `startUrl`. <br><br>If the URL contains variables, this regex applies after the interpolation of the variables. The format is `s/your_regex/your_substitution/modifiers` and follows JavaScript regex syntax. For example, `s/(https://www.)(.*)/$1extra-$2/` to transform `https://www.example.com` into `https://www.extra-example.com`. |
| `variables`                 | Object           | The variables to replace in the test. This object should contain key as the name of the variable to replace and values as the new value of the variable to replace.                                                                                                                                                                                                                                                                                                                                    |

## Use the testing tunnel

You can combine variable overrides with the [Continuous Testing Tunnel][3] to run tests within your development environment. The testing tunnel creates an end-to-end encrypted HTTP proxy between your infrastructure and Datadog that allows all test requests sent through the CLI to be automatically routed through the `datadog-ci` client. This allows you to run tests with end-to-end encryption at every stage of your software development lifecycle, from pre-production environments to your production system.

## End-to-end testing process

To verify the Synthetics command works as expected, trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'
export DATADOG_APP_KEY='<application key>'

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
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests' --config global.config.json --jUnitReport e2e-test-junit
```

Reporters can hook themselves into the `MainReporter` of the command.

### Available hooks

| Hook name        | Parameters                                                                               | Description                                                     |
| :--------------- | :--------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `log`            | `(log: string)`                                                                          | Called for logging.                                             |
| `error`          | `(error: string)`                                                                        | Called whenever an error occurs.                                |
| `initErrors`     | `(errors: string[])`                                                                     | Called whenever an error occurs during the tests parsing phase. |
| `reportStart`    | `(timings: {startTime: number})`                                                         | Called at the start of the report.                              |
| `resultEnd`      | `(result: Result, baseUrl: string)`                                                      | Called for each result at the end of all results.               |
| `resultReceived` | `(result: Result)`                                                                       | Called when a result is received.                               |
| `testTrigger`    | `(test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride)` | Called when a test is triggered.                                |
| `testWait`       | `(test: Test)`                                                                           | Called when a test is waiting to receive its results.           |
| `testsWait`      | `(tests: Test[])`                                                                        | Called when all tests are waiting to receive their results.     |
| `runEnd`         | `(summary: Summary, baseUrl: string)`                                                    | Called at the end of the run.                                   |

## View test results

You can see results for CI batches by clicking on a batch in the [Continuous Testing Explorer][4], or by clicking on a test in the [Synthetic Tests page][5].

You can also see the outcome of test executions directly in your CI as your tests are being executed. To identify what caused a test to fail, look at the execution logs and search for causes of the failed assertion.

{{< code-block lang="bash" filename="Terminal" disable_copy="true" collapsible="true" >}}
  yarn datadog-ci synthetics run-tests --config synthetics.global.json
  yarn run v1.22.4
  $ /Users/demo.user/go/src/github.com/Datadog/tmp/test/testDemo/node_modules/.bin/datadog-ci synthetics run-tests --config synthetics.global.json
  Finding files in /Users/demo.user/go/src/github.com/Datadog/tmp/test/testDemo/{,!(node_modules)/**/}*.synthetics.json

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
{{< /code-block >}}

## Further reading

{{< partial name="whats-next/whats-next.html" >}}

[1]: https://www.npmjs.com/package/@datadog/datadog-ci
[2]: https://github.com/TooTallNate/node-proxy-agent
[3]: https://docs.datadoghq.com/continuous_testing/testing_tunnel/
[4]: https://app.datadoghq.com/synthetics/explorer/
[5]: https://app.datadoghq.com/synthetics/tests