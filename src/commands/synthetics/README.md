<!-- partial <div class="alert alert-info">This page is about configuring Continuous Testing tests for your Continuous Integration (CI) and Continuous Delivery (CD) pipelines. If you want to bring your CI/CD metrics and data into Datadog dashboards, see the <a href="https://docs.datadoghq.com/continuous_integration/" target="_blank">CI Visibility</a> section.</div> partial -->

## Overview

Use the [`@datadog-ci` NPM package][1] to run Continuous Testing tests directly within your CI/CD pipeline. You can automatically halt a build, block a deployment, and roll back a deployment when a Synthetic test detects a regression.

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

1. Defined in a [global configuration file](#global-configuration-file):

    ```json
    {
      "apiKey": "<API_KEY>",
      "appKey": "<APPLICATION_KEY>",
    }
    ```

2. Defined as environment variables:

    ```bash
    export DD_API_KEY="<API_KEY>"
    export DD_APP_KEY="<APPLICATION_KEY>"
    ```

3. Passed to the CLI when running your tests:

    ```bash
    yarn datadog-ci synthetics run-tests --apiKey "<API_KEY>" --appKey "<APPLICATION_KEY>"
    ```

### Global configuration file

Using a global configuration file (Global Config) is one of the ways to configure datadog-ci. To do so, create a JSON configuration file on your system. Specify the path to the file using the `--config` flag or configure it through the `DATADOG_SYNTHETICS_CONFIG_PATH` environment variable [when launching your tests](#run-tests-command) or [uploading a new application](#upload-application-command). If you don't specify a file path, Datadog looks for a file with the default filename of `datadog-ci.json`.

See each command's list of configurations below for the list of advanced options in the global configuration file relevant to each [run-tests command](#run-tests-command) and [upload-application command](#upload-application-command). For an example configuration file, see this [`global-config-complete-example.json` file][9].

Example:

```jsonc
{
  "apiKey": "<API_KEY>",
  "appKey": "<APPLICATION_KEY>",
  "batchTimeout": 1800000,
  "datadogSite": "datadoghq.com",
  "defaultTestOverrides": {
    "allowInsecureCertificates": true,
    "basicAuth": {"username": "test", "password": "test"},
    "body": "{\"fakeContent\":true}",
    "bodyType": "application/json",
    "cookies": "name1=value1;name2=value2;",
    "setCookies": "name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly",
    "defaultStepTimeout": 15,
    "deviceIds": ["chrome.laptop_large"],
    "executionRule": "skipped",
    "followRedirects": true,
    "headers": {"NEW_HEADER": "NEW VALUE"},
    "locations": ["aws:us-east-1"],
    "mobileApplicationVersion": "01234567-8888-9999-abcd-efffffffffff",
    "mobileApplicationVersionFilePath": "path/to/application.apk",
    "resourceUrlSubstitutionRegexes": ["(https://www.)(.*)|$1staging-$2"],
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

### Environment Variables

In addition to the global configuration file, you can configure all properties using environment variables. If a property is defined in both the global configuration file and as an environment variable, the environment variable takes precedence.

Example:

```bash
export DATADOG_SITE=datadoghq.com
```

### Command line options

The CLI provides another way to set options and configure the behavior of datadog-ci. These options will override the global configuration file and environment variables.

Example:

```bash
yarn datadog-ci synthetics run-tests --public-id pub-lic-id1
```

The priority of the 3 forms of configuration is as follows:

```yml
Global Config < Environment variables < CLI parameters
```

### Using datadog-ci as a library

You can also use the `datadog-ci` package as a library in your Node.js application to trigger tests. To do so, import the package from the Synthetics `run-tests` command and call the `executeWithDetails()` function.

``` javascript
import { synthetics } from '@datadog/datadog-ci'

const { results, summary } = await synthetics.executeTests(...)
```

### Use a proxy

You can configure a proxy to be used for outgoing connections to Datadog. To do this, use the `proxy` key of the global configuration file or the `HTTPS_PROXY` environment variable.

**Note**: This is the only exception where the global configuration file takes precedence over the environment variable. There is no option to set this through the CLI.

As the [`proxy-agent` library][2] is used to configure the proxy, the supported protocols include `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The `proxy` key of the global configuration file is passed to a new `proxy-agent` instance, which means the same configuration for the library is supported.

To use a proxy, you need to first set the CA certificate so datadog-ci trusts your proxy. You can do this by setting the `NODE_EXTRA_CA_CERTS` environment variable to the path of your CA certificate. Otherwise, you might get a `unable to verify the first certificate` error.

```bash
export NODE_EXTRA_CA_CERTS=/path/to/your-ca-cert.pem
```

When using the global configuration, `host` and `port` keys are mandatory arguments and the `protocol` key defaults to `http` if not defined.

Example:

```jsonc
{
  // ...
  "proxy": {
    "auth": {
      "username": "login",
      "password": "pwd"
    },
    "host": "127.0.0.1",
    "port": 3128,
    "protocol": "http"
  },
  // ...
}
```

The format used for the `HTTPS_PROXY` environment variable is `<protocol>://<username>:<password>@<host>:<port>`, as described by the [proxy-from-env][13] library that [`proxy-agent` library][2] uses for parsing env variables.
The `HTTPS_PROXY` variable is used instead of the `HTTP_PROXY` one, because the Datadog API uses the HTTPS protocol.

Example:

```bash
export HTTPS_PROXY=http://login:pwd@127.0.0.1:3128
```

If you want to confirm that a proxy is being used, you can set the `DEBUG` environment variable to `proxy-agent` like this:

```bash
DEBUG=proxy-agent yarn datadog-ci synthetics run-tests
```

## Run Tests Command

You can decide to have the CLI auto-discover all your `**/*.synthetics.json` Synthetic tests (see [test files](#test-files)) or specify the tests you want to run using the `-p,--public-id` flag.

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

**Note**: If you are launching your tests with a custom filename for the [global configuration file](#global-configuration-file), append the command associated to your `datadog-ci-synthetics` script with `--config <CUSTOM_PATH_TO_GLOBAL_CONFIG_FILE>`.

<!-- xxz tab xxx -->
<!-- xxx tab "Yarn" xxx -->

Run tests by executing the CLI through **Yarn**:

The `run-tests` sub-command accepts the `--public-id` (or shorthand `-p`) argument to trigger only the specified test. It can be set multiple times to run multiple tests:

```bash
yarn datadog-ci synthetics run-tests --public-id pub-lic-id1 --public-id pub-lic-id2
```

It is also possible to trigger tests corresponding to a search query by using the `--search` (or shorthand `-s`) argument. With this option, the overrides defined in your [global configuration file](#global-configuration-file) apply to all tests discovered with the search query.

```bash
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests'
```

You can use `--files` (shorthand `-f`) to override the default glob pattern (which would match all `**/*.synthetics.json` files).

```bash
yarn datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json
```

**Note**: If you are launching your tests with a custom filename for the [global configuration file](#global-configuration-file), append the command associated to your `datadog-ci-synthetics` script with `--config <CUSTOM_PATH_TO_GLOBAL_CONFIG_FILE>`.

<!-- xxz tab xxx -->
<!-- xxz tabs xxx -->

### List of Configurations

<!--
  When updating any of these, don't forget to update the Google Sheets document and relevant CI integrations:
    https://docs.google.com/spreadsheets/d/1VB8ntED7hz2McIwp7NaHADVt16nFUuNnKERBl78tldQ/edit?usp=sharing

  For more information, see https://datadoghq.atlassian.net/wiki/x/LwBfyQ
-->

#### `apiKey` (Required)

Your Datadog API key. This key is [created in your Datadog organization][15] and should be stored as a secret.

**Configuration options**

* Global Config: `"apiKey": "<API_KEY>"`
* ENV variable: `DD_API_KEY="<API_KEY>"`
* CLI param: `--apiKey "<API_KEY>"`

#### `appKey` (Required)

Your Datadog application key. This key is [created in your Datadog organization][15] and should be stored as a secret.

**Configuration options**

* Global Config: `"appKey": "<APPLICATION_KEY>"`
* ENV variable: `DD_APP_KEY="<APPLICATION_KEY>"`
* CLI param: `--appKey "<APPLICATION_KEY>"`

#### `batchTimeout`

The duration in milliseconds after which the CI batch fails as timed out. This does not affect the outcome of a test run that already started.

**Configuration options**

* Default: `1800000` (30 minutes)
* Global Config: `"batchTimeout": 1800000`
* ENV variable: `DATADOG_SYNTHETICS_BATCH_TIMEOUT=1800000`
* CLI param: `--batchTimeout 1800000`

#### `configPath`

The path to the [global configuration file](#global-configuration-file) that configures datadog-ci.

**Configuration options**

* Default: `datadog-ci.json`
* Global Config: N/A
* ENV variable: `DATADOG_SYNTHETICS_CONFIG_PATH=global-config.json`
* CLI param: `--config global-config.json`

#### `datadogSite`

Your Datadog site. The possible values are listed [in this table][16].

<!-- partial Set it to {{< region-param key="dd_site" code="true" >}} (ensure the correct SITE is selected on the right). partial -->

**Configuration options**

* Default: `datadoghq.com`
* Global Config: `"datadogSite": "datadoghq.com"`
* ENV variable: `DATADOG_SITE=datadoghq.com`
* CLI param: `--datadogSite datadoghq.com`

#### `defaultTestOverrides`

Overrides for Synthetic tests applied to all tests.

**Configuration options**

* Global Config: See [test overrides](#test-overrides)
* ENV variable: all variables follow the  `DATADOG_SYNTHETICS_OVERRIDE_...` pattern
* CLI param: all CLI params use the `--override option=value` pattern

#### `failOnCriticalErrors`

Fail the CI job if a critical error that is typically transient occurs, such as rate limits, authentication failures, or Datadog infrastructure issues.

**Configuration options**

* Default: `false`
* Global Config: `"failOnCriticalErrors": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS=true`
* CLI param: `--failOnCriticalErrors` / `--no-failOnCriticalErrors`

#### `failOnMissingTests`

Fail the CI job if the list of tests to run is empty or if some explicitly listed tests are missing.

**Configuration options**

* Default: `false`
* Global Config: `"failOnMissingTests": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS=true`
* CLI param: `--failOnMissingTests` / `--no-failOnMissingTests`

#### `failOnTimeout`

Fail the CI job if the CI batch fails as timed out.

**Configuration options**

* Default: `true`
* Global Config: `"failOnTimeout": true`
* ENV variable: `DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT=true`
* CLI param: `--failOnTimeout` / `--no-failOnTimeout`

#### `files`

Glob patterns to detect Synthetic [test configuration files](#test-files).

**Configuration options**

* Default: `["{,!(node_modules)/**/}*.synthetics.json"]`
* Global Config: `"files": ["{,!(node_modules)/**/}*.synthetics.json"]`
* ENV variable: `DATADOG_SYNTHETICS_FILES="{,!(node_modules)/**/}*.synthetics.json"`
* CLI param: `-f "{,!(node_modules)/**/}*.synthetics.json"` / `--files "{,!(node_modules)/**/}*.synthetics.json"`

#### `jUnitReport`

The filename for a JUnit report if you want to generate one.

**Configuration options**

* Default: None
* Global Config: `"jUnitReport": "e2e-test-junit.xml"`
* ENV variable: `DATADOG_SYNTHETICS_JUNIT_REPORT="e2e-test-junit.xml"`
* CLI param:`-j "e2e-test-junit.xml"` / `--jUnitReport "e2e-test-junit.xml"`

#### `mobileApplicationVersionFilePath`

Override the mobile application version for [Synthetic mobile application tests][18] with a local or recently built application.

**Configuration options**

* Global Config: `"mobileApplicationVersionFilePath": "path/to/application.apk"`
* ENV variable: Not Available
* CLI param: `--mobileApp "path/to/application.apk"` / `--mobileApplicationVersionFilePath "path/to/application.apk"`

#### `proxy`

The proxy to be used for outgoing connections to Datadog. `host` and `port` keys are mandatory arguments, the `protocol` key defaults to `http`. Supported values for the `protocol` key are `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The library used to configure the proxy is the [proxy-agent][2] library.

**Configuration options**

* Global Config: See [Use a proxy](#use-a-proxy) for an example.
* ENV variable: `HTTPS_PROXY=http://login:pwd@127.0.0.1:3128`
* CLI param: N/A

#### `publicIds`

Public IDs of Synthetic tests to run. If no value is provided, tests are discovered in Synthetic [test configuration files](#test-files).

**Configuration options**

* Default: None
* Global Config: `"publicIds": ["abc-def-ghi", "123-456-789"]`
* ENV variable: `DATADOG_SYNTHETICS_PUBLIC_IDS="abc-def-ghi;123-456-789"`
* CLI param: `-p "abc-def-ghi" --public-id "123-456-789"`

#### `selectiveRerun`

Whether to only rerun failed tests. If a test has already passed for a given commit, it will not be rerun in subsequent CI batches. By default, your [organization's default setting][17] is used. Set it to `false` to force full runs when your configuration enables it by default.

**Configuration options**

* Default: `false`
* Global Config: `"selectiveRerun": true`
* ENV variable: `DATADOG_SYNTHETICS_SELECTIVE_RERUN=true`
* CLI param: `--selectiveRerun` / `--no-selectiveRerun`

#### `subdomain`

The custom subdomain to access your Datadog organization. If your URL is `myorg.datadoghq.com`, the custom subdomain is `myorg`.

**Configuration options**

* Default: `app`
* Global Config: `"subdomain": "myorg"`
* ENV variable: `DATADOG_SUBDOMAIN="myorg"`
* CLI param: `--subdomain "myorg"`

#### `testSearchQuery`

Use a [search query][14] to select which Synthetic tests to run. Use the [Synthetic Tests list page's search bar][5] to craft your query, then copy and paste it.

In the command line, the query should be inside single quotes. Here is an example with a facet, a `value` tag, and a `<KEY>:<VALUE>` tag:

```
datadog-ci synthetics run-tests --search 'team:unicorn tag:e2e-tests tag:"managedBy:terraform"'
```

**Configuration options**

* Default: None
* Global Config: `"testSearchQuery": "tag:e2e-tests"`
* ENV variable: `DATADOG_SYNTHETICS_TEST_SEARCH_QUERY="tag:e2e-tests"`
* CLI param: `-s "tag:e2e-tests"` / `--search "tag:e2e-tests"`

#### `tunnel`

Use the [Continuous Testing tunnel](https://docs.datadoghq.com/continuous_testing/environments/proxy_firewall_vpn#what-is-the-testing-tunnel) to launch tests against internal environments.

For more information, see [Using Local and Staging Environments](#using-local-and-staging-environments).

**Configuration options**

* Default: `false`
* Global Config: `"tunnel": true`
* ENV variable: `DATADOG_SYNTHETICS_TUNNEL=true`
* CLI param: `-t` / `--tunnel` / `--no-tunnel`

### Test overrides

<!--
  When updating any of these, don't forget to update the Google Sheets document and relevant CI integrations:
    https://docs.google.com/spreadsheets/d/1VB8ntED7hz2McIwp7NaHADVt16nFUuNnKERBl78tldQ/edit?usp=sharing

  For more information, see https://datadoghq.atlassian.net/wiki/x/LwBfyQ
-->

All test overrides are optional and allow overriding the test configuration that is stored in Datadog.

These overrides can either be applied to all tests with `defaultTestOverrides` in the [global configuration file](#global-configuration-file), or to some specific tests with `testOverrides` in a [test configuration file](#test-files).

These options can also be set with environment variables starting with `DATADOG_SYNTHETICS_OVERRIDE_...` or with the `--override` CLI parameter following this pattern: `--override option=value`.

#### `allowInsecureCertificates` (Boolean)

Override the certificate checks in Synthetic API and Browser tests.

**Configuration options**

* Global/Test Config: `"allowInsecureCertificates": true`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES=true`
* CLI param: `--override allowInsecureCertificates=true`

#### `basicAuth` (Object)

Override the credentials for basic authentication.

* `username` (String): The username for basic authentication.
* `password` (String): The password for basic authentication.

**Configuration options**

* Global/Test Config: `"basicAuth": {"username": "test_username", "password": "test_password"}`
* ENV variable:
  * `DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME=test_username`
  * `DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD=test_password`
* CLI param:
  * `--override basicAuth.username=test_username`
  * `--override basicAuth.password=test_password`

#### `body` (String)

Override the data to send in API tests.

**Configuration options**

* Global/Test Config: `"body": "{\"fakeContent\":true}"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_BODY={"fakeContent":true}`
* CLI param: `--override body={"fakeContent":true}`

#### `bodyType` (String)

Override the content type for the data to send in API tests.

**Configuration options**

* Global/Test Config: `"bodyType": "application/json"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE=application/json`
* CLI param: `--override bodyType=application/json`

#### `cookies` (String or object)

Override the cookies for API and browser tests.

* If this is a string, it is used to replace the original cookies.
* If this is an object, the format must be `{append?: boolean, value: string}`, and depending on the value of `append`, it is appended or replaces the original cookies.

**Configuration options**

* Global/Test Config: `"cookies": "name1=value1;name2=value2"` (equivalent to `"append": false`) or `"cookies": {"append": true, "value": "name1=value1;name2=value2"}`
* ENV variable:
  * `DATADOG_SYNTHETICS_OVERRIDE_COOKIES="name1=value1;name2=value2"`
  * `DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND=true`
* CLI param:
  * `--override cookies="name1=value1;name2=value2"`
  * `--override cookies.append=true`

#### `setCookies` (String or object)

Override the `Set-Cookie` headers in browser tests only.

* If this is a string, it is used to replace the original `Set-Cookie` headers.
* If this is an object, the format must be `{append?: boolean, value: string}`, and depending on the value of `append`, it is appended or replaces the original `Set-Cookie` headers.

**Configuration options**

* Global/Test Config: `"setCookies": "name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly"` (equivalent to `"append": false`) or `"setCookies": {"append": true, "value": "setCookies": "name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly"}`
* ENV variable:
  * `DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES="name1=value1;name2=value2"`
  * `DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND=true`
* CLI param:
  * `--override setCookies="setCookies": "name1=value1 \n name2=value2; Domain=example.com \n name3=value3; Secure; HttpOnly"`
  * `--override setCookies.append=true`

#### `defaultStepTimeout` (Number)

Override the maximum duration of steps in seconds for browser tests. This does not override individually set step timeouts.

**Configuration options**

* Global/Test Config: `"defaultStepTimeout": 15`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT=15`
* CLI param: `--override defaultStepTimeout=15`

#### `deviceIds` (Array)

Override the list of devices on which to run the Synthetic tests.

**Configuration options**

* Global/Test Config: `"deviceIds": ["chrome.laptop_large", "firefox.tablet"]`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS="chrome.laptop_large;firefox.tablet"`
* CLI param: `--override deviceIds="chrome.laptop_large;firefox.tablet"`

#### `executionRule` (String)

Override the execution rule for Synthetic tests.

The execution rule for the test defines the behavior of the CI batch in case of a failing test. It accepts one of the following values:

* `blocking`: A failed test causes the CI batch to fail.
* `non_blocking`: A failed test does not cause the CI batch to fail.
* `skipped`: The test is not run at all.

**Configuration options**

* Global/Test Config: `"executionRule": "skipped"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE=skipped`
* CLI param: `--override executionRule=skipped`

#### `followRedirects` (Boolean)

Override whether or not to follow HTTP redirections in API tests.

**Configuration options**

* Global/Test Config: `"followRedirects": true`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS=true`
* CLI param: `--override followRedirects=true`

#### `headers` (Object)

Override the headers in the API and browser tests.

This object specifies the headers to be replaced in the test. It should have keys representing the names of the headers to be replaced, and values indicating the new header values.

**Configuration options**

* Global/Test Config: `"headers": {"NEW_HEADER_1": "NEW VALUE 1", "NEW_HEADER_2": "NEW VALUE 2"}`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_HEADERS='{"NEW_HEADER_1":"NEW VALUE 1", "NEW_HEADER_2":"NEW VALUE 2"}'` (**Note**: This must be valid JSON)
* CLI param:
  * `--override headers.NEW_HEADER_1="NEW VALUE 1"`
  * `--override headers.NEW_HEADER_2="NEW VALUE 2"`

#### `locations` (Array)

Override the list of locations to run the test from. The possible values are listed [in this API response][12].

**Configuration options**

* Global/Test Config: `"locations": ["aws:us-east-1", "gcp:europe-west3"]`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS="aws:us-east-1;gcp:europe-west3"`
* CLI param: `--override locations="aws:us-east-1;gcp:europe-west3"`

#### `mobileApplicationVersion` (String)

Override the mobile application version for Synthetic mobile application tests. The version must be uploaded and available within Datadog.

**Configuration options**

* Global/Test Config: `"mobileApplicationVersion": "01234567-8888-9999-abcd-efffffffffff"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION=01234567-8888-9999-abcd-efffffffffff`
* CLI param: `--mobileApplicationVersion=01234567-8888-9999-abcd-efffffffffff`

#### `mobileApplicationVersionFilePath` (String)

Override the application version for Synthetic mobile application tests.

**Configuration options**

* Global/Test Config: `"mobileApplicationVersionFilePath": "path/to/application.apk"`
* ENV variable: Not Available
* CLI param: `--mobileApplicationVersionFilePath=path/to/application.apk`

#### `resourceUrlSubstitutionRegexes` (Array)

An array of regex patterns to modify resource URLs in the test. This can be useful for dynamically changing resource URLs during test execution.

Each regex pattern should be in the format:

- **`your_regex|your_substitution`**: The pipe-based syntax, to avoid any conflicts with / characters in URLs.
  - For example, `https://example.com(.*)|http://subdomain.example.com$1` to transform `https://example.com/resource` to `http://subdomain.example.com/resource`.
- **`s/your_regex/your_substitution/modifiers`**: The slash syntax, which supports modifiers.
  - For example, `s/(https://www.)(.*)/$1staging-$2/` to transform `https://www.example.com/resource` into `https://www.staging-example.com/resource`.

**Configuration options**

* Global/Test Config: `"resourceUrlSubstitutionRegexes": ["(https://www.)(.*)|$1staging-$2"]`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES='(https://www.)(.*)|$1staging-$2'`
* CLI param: `--override resourceUrlSubstitutionRegexes='(https://www.)(.*)|$1staging-$2'`

#### `retry` (Object)

Override the retry policy for the test.

This object has the two following independent attributes:
* `count` (Integer): The number of attempts to perform in case of test failure.
* `interval` (Integer): The interval between attempts in milliseconds.

**Configuration options**

* Global/Test Config: `"retry": {"count": 2, "interval": 300}`
* ENV variable:
  * `DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT=2`
  * `DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL=300`
* CLI param:
  * `--override retry.count=2`
  * `--override retry.interval=300`

#### `startUrl` (String)

Override the start URL for API and browser tests.

Local and [global variables][11] specified in the URL (for example, `{{ URL }}`) are replaced when the test is run.

You can combine this with the `variables` override to override both the start URL and the variable values. For example:

```bash
--override startUrl="{{ URL }}?static_hash={{ STATIC_HASH }}" --override variables.STATIC_HASH=abcdef
```

**Configuration options**

* Global/Test Config: `"startUrl": "{{ URL }}?static_hash={{ STATIC_HASH }}"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_START_URL="{{ URL }}?static_hash={{ STATIC_HASH }}"`
* CLI param: `--override startUrl="{{ URL }}?static_hash={{ STATIC_HASH }}"`

#### `startUrlSubstitutionRegex` (String)

A regex to modify the starting URL of browser and HTTP tests, whether it comes from the original test or the `startUrl` override.

If the URL contains variables, this regex applies after the interpolation of the variables.

There are two possible formats:

- **`your_regex|your_substitution`**: The pipe-based syntax, to avoid any conflicts with `/` characters in URLs.
  - For example, `https://example.com(.*)|http://subdomain.example.com$1` to transform `https://example.com/test` to `http://subdomain.example.com/test`.
- **`s/your_regex/your_substitution/modifiers`**: The slash syntax, which supports modifiers.
  - For example, `s/(https://www.)(.*)/$1extra-$2/` to transform `https://www.example.com` into `https://www.extra-example.com`.

**Configuration options**

* Global/Test Config: `"startUrlSubstitutionRegex": "(https://www.)(.*)|$1extra-$2"`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX='(https://www.)(.*)|$1extra-$2'`
* CLI param: `--override startUrlSubstitutionRegex='(https://www.)(.*)|$1extra-$2'`

#### `testTimeout` (Number)

Override the maximum duration in seconds for browser tests.

**Configuration options**

* Global/Test Config: `"testTimeout": 300`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT=300`
* CLI param: `--override testTimeout=300`

#### `variables` (Object)

Override existing or inject new local and [global variables][11] in Synthetic tests.

This object should include keys corresponding to the names of the variables to be replaced, and values representing the new values for these variables.

**Configuration options**

* Global/Test Config: `"variables": {"NEW_VARIABLE_1": "NEW VARIABLE 1", "NEW_VARIABLE_2": "NEW VARIABLE 2"}`
* ENV variable: `DATADOG_SYNTHETICS_OVERRIDE_VARIABLES='{"NEW_VARIABLE_1":"NEW VARIABLE 1", "NEW_VARIABLE_2":"NEW VARIABLE 2"}'` (**Note**: This must be valid JSON)
* CLI param:
  * `--override variables.NEW_VARIABLE_1="NEW VARIABLE 1"`
  * `--override variables.NEW_VARIABLE_2="NEW VARIABLE 2"`

### Configure a start URL

To configure which URL your test starts on, provide a `startUrl` to your test object. Build your own starting URL with any part of your test's original starting URL and include local and [global variables][11].

### Configure a custom subdomain

If the organization uses a custom subdomain to access Datadog, this needs to be set in the `DATADOG_SUBDOMAIN` environment variable or in the global configuration file under the `subdomain` key in order to properly display the test results URL.

For example, if the URL used to access Datadog is `myorg.datadoghq.com`, set the environment variable to `myorg`:

```bash
export DATADOG_SUBDOMAIN="myorg"
```

### Configure custom locations

You can use `DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS` to override the locations where your tests run. Locations should be separated with a semicolon (`;`). The configuration in [test files](#test-files) takes precedence over other overrides.

```bash
export DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS="aws:us-east-1;aws:us-east-2"
```

### Test files

Test configuration files (Test Config) let you customize individual tests or set up multiple runs of the same test with different settings, beyond what you can do with other configuration methods.

You can find a list of all these options in the [test overrides](#test-overrides) section.

These files take precedence over global configuration files, environment variables, and CLI parameters. The priority order including test configurations is as follows:

``` yml
Global Config < Environment variables < CLI parameters < Test Config
```

To determine which tests to run, one or more of those options may be passed to `datadog-ci`:
- The [`files` option](#files)
- The [`publicIds` option](#publicids)
- The [`testSearchQuery` option](#testsearchquery)

If none of these options is passed, `datadog-ci` auto-discovers test configuration files with the `{,!(node_modules)/**/}*.synthetics.json` glob pattern (every file ending with `.synthetics.json`, except for those in the `node_modules` folder).

**Note**: The file search starts from the current working directory, so it may be slow if the command is run from a large directory, like a home folder. If file search command is too slow, consider:
- Using the above options to specify the tests (this will disable the file search),
- Or refining the glob pattern with the [`files` option](#files).
  - For example, by using `*` instead of `**` or by adding a specific folder to the pattern.

The `<TEST_PUBLIC_ID>` can be either the identifier of the test found in the URL of a test details page (for example, for `https://app.datadoghq.com/synthetics/details/abc-def-ghi`, it would be `abc-def-ghi`) or the full URL to the details page (for example, directly `https://app.datadoghq.com/synthetics/details/abc-def-ghi`).

Example:

```jsonc
// myTest.synthetics.json
{
  "tests": [
    {
      "id": "<TEST_PUBLIC_ID_1>",
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
        "resourceUrlSubstitutionRegexes": ["(https://www.)(.*)|$1staging-$2"],
        "retry": {"count": 2, "interval": 300},
        "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
        "startUrlSubstitutionRegex": "s/(https://www.)(.*)/$1extra-$2/",
        "testTimeout": 300,
        "variables": {"MY_VARIABLE": "new title"}
      }
    },
    {
      "id": "<TEST_PUBLIC_ID_2>",
      "testOverrides": {
        "allowInsecureCertificates": true,
        // ...
        "variables": {"MY_VARIABLE": "new title"}
      }
    }
  ]
}
```

## Upload Application Command

This command uploads a new version to an **existing** mobile application.

### List of Configurations

<!--
  When updating any of these, don't forget to update the Google Sheets document and relevant CI integrations:
    https://docs.google.com/spreadsheets/d/1VB8ntED7hz2McIwp7NaHADVt16nFUuNnKERBl78tldQ/edit?usp=sharing

  For more information, see https://datadoghq.atlassian.net/wiki/x/LwBfyQ
-->

#### `apiKey` (Required)

Your Datadog API key. This key is [created in your Datadog organization][15] and should be stored as a secret.

**Configuration options**

* Global Config: `"apiKey": "<API_KEY>"`
* ENV variable: `DD_API_KEY="<API_KEY>"`
* CLI param: `--apiKey "<API_KEY>"`

#### `appKey` (Required)

Your Datadog application key. This key is [created in your Datadog organization][15] and should be stored as a secret.

**Configuration options**

* Global Config: `"appKey": "<APPLICATION_KEY>"`
* ENV variable: `DD_APP_KEY="<APPLICATION_KEY>"`
* CLI param: `--appKey "<APPLICATION_KEY>"`

#### `configPath`

The path to the [global configuration file](#global-configuration-file) that configures datadog-ci.

**Configuration options**

* Default: `datadog-ci.json`
* Global Config: N/A
* ENV variable: `DATADOG_SYNTHETICS_CONFIG_PATH=global-config.json`
* CLI param: `--config global-config.json`

#### `datadogSite`

Your Datadog site. The possible values are listed [in this table][16].

<!-- partial Set it to {{< region-param key="dd_site" code="true" >}} (ensure the correct SITE is selected on the right). partial -->

**Configuration options**

* Default: `datadoghq.com`
* Global Config: `"datadogSite": "datadoghq.com"`
* ENV variable: `DATADOG_SITE=datadoghq.com`
* CLI param: `--datadogSite datadoghq.com`

#### `latest`

Mark the new version as `latest`. Any tests that run on the latest version will use this version on their next run.

**Configuration options**

* Default: `false`
* Global Config: `"latest": true`
* ENV variable:  `DATADOG_SYNTHETICS_LATEST=true`
* CLI param: `--latest` / `--no-latest`

#### `mobileApplicationId` (Required)

The ID of the application you want to upload the new version to.

**Configuration options**

* Global Config: `"mobileApplicationId": "123-123-123"`
* ENV variable: `DATADOG_SYNTHETICS_MOBILE_APPLICATION_ID=123-123-123`
* CLI param: `--mobileApplicationId 123-123-123`

#### `mobileApplicationVersionFilePath` (Required)

The path to the new version of your mobile application (`.apk` or `.ipa`).

**Configuration options**

* Global Config: `"mobileApplicationVersionFilePath": example/test.apk`
* ENV variable: Not Available
* CLI param: `--mobileApplicationVersionFilePath example/test.apk`

#### `proxy`

The proxy to be used for outgoing connections to Datadog. `host` and `port` keys are mandatory arguments, the `protocol` key defaults to `http`. Supported values for the `protocol` key are `http`, `https`, `socks`, `socks4`, `socks4a`, `socks5`, `socks5h`, `pac+data`, `pac+file`, `pac+ftp`, `pac+http`, and `pac+https`. The library used to configure the proxy is the [proxy-agent][2] library.

**Configuration options**

* Global Config: See [Use a proxy](#use-a-proxy) for an example.
* ENV variable: N/A
* CLI param: N/A

#### `versionName` (Required)

The name of the new version. It has to be unique.

**Configuration options**

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
  "apiKey": "<API_KEY>",
  "appKey": "<APPLICATION_KEY>",
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

The default file name for the [global configuration file](#global-configuration-file) is `datadog-ci.json`. If you use this name for your global configuration file, you may omit the `--config` flag.

## Using local and staging environments

You can combine variable overrides with [Local and Staging Environments][3] to run tests within your development environment. This connection ensures that all test requests sent through the CLI are automatically routed through the `datadog-ci` client. 

This allows you to run tests with end-to-end encryption at every stage of your software development lifecycle, from pre-production environments to your production system.

## End-to-end testing process

To verify the Synthetics command works as expected, trigger a test run and verify it returns 0:

```bash
export DD_API_KEY='<API_KEY>'
export DD_APP_KEY='<APPLICATION_KEY>'

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

To enable the JUnit report, specify a filename for your JUnit report with `-j/--jUnitReport`.

```bash
yarn datadog-ci synthetics run-tests -s 'tag:e2e-tests' --config global-config.json --jUnitReport junit-report.xml
```

Reporters can hook themselves into the `MainReporter` of the command.

### Available hooks

| Hook name        | Parameters                                                                                      | Description                                                     |
| :--------------- | :---------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `log`            | `(log: string)`                                                                                 | Called for logging.                                             |
| `error`          | `(error: string)`                                                                               | Called whenever an error occurs.                                |
| `initErrors`     | `(errors: string[])`                                                                            | Called whenever an error occurs during the tests parsing phase. |
| `testTrigger`    | `(test: Test, testId: string, executionRule: ExecutionRule, testOverrides: UserConfigOverride)` | Called when a test is triggered.                                |
| `testWait`       | `(test: Test)`                                                                                  | Called when a test is waiting to receive its results.           |
| `testsWait`      | `(tests: Test[], baseUrl: string, batchId: string, skippedCount?: number)`                      | Called when all tests are waiting to receive their results.     |
| `resultReceived` | `(result: ResultInBatch)`                                                                       | Called when a result is received.                               |
| `resultEnd`      | `(result: Result, baseUrl: string)`                                                             | Called for each result at the end of all results.               |
| `reportStart`    | `(timings: {startTime: number})`                                                                | Called at the start of the report.                              |
| `runEnd`         | `(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings)`                      | Called at the end of the run.                                   |

## View test results

You can see results for CI batches by clicking on a batch in the [Synthetic Monitoring & Testing Results Explorer][4] or clicking on a test on the [Synthetic Tests list page][5].

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

## Further reading

Additional helpful documentation, links, and articles:

* [Use Datadog's GitHub Action to add continuous testing to your workflows][6]
* [Learn about Continuous Testing and CI/CD][7]
* [Learn about Mobile Application Testing][10]
* [Learn about the Synthetic Monitoring & Testing Results Explorer][8]
* [Learn about Testing Local and Staging Environments][3]

[1]: https://www.npmjs.com/package/@datadog/datadog-ci
[2]: https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy-agent
[3]: https://docs.datadoghq.com/continuous_testing/environments/
[4]: https://app.datadoghq.com/synthetics/explorer/
[5]: https://app.datadoghq.com/synthetics/tests
[6]: https://www.datadoghq.com/blog/datadog-github-action-synthetics-ci-visibility/
[7]: https://docs.datadoghq.com/continuous_testing/cicd_integrations/
[8]: https://docs.datadoghq.com/continuous_testing/explorer/
[9]: https://github.com/DataDog/datadog-ci/blob/master/src/commands/synthetics/examples/global-config-complete-example.json
[10]: https://docs.datadoghq.com/mobile_app_testing/
[11]: https://docs.datadoghq.com/synthetics/platform/settings/?tab=specifyvalue#global-variables
[12]: https://app.datadoghq.com/api/v1/synthetics/locations?only_public=true
[13]: https://www.npmjs.com/package/proxy-from-env#external-resources
[14]: https://docs.datadoghq.com/synthetics/explore/#search
[15]: https://docs.datadoghq.com/account_management/api-app-keys/
[16]: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
[17]: https://app.datadoghq.com/synthetics/settings/continuous-testing
[18]: https://docs.datadoghq.com/synthetics/mobile_app_testing/

<!--
  This page is single-sourced:
  https://github.com/DataDog/documentation/blob/7007931530baf7da59310e7224a26dc9a71c53c5/local/bin/py/build/configurations/pull_config_preview.yaml#L315
-->
