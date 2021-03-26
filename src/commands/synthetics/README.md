# Synthetics command

Run Synthetics tests from your CI.

## Usage

### Setup

You need to either have `DATADOG_API_KEY` and `DATADOG_APP_KEY` in your environment or pass them to the CLI.
```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
export DATADOG_APP_KEY="<APPLICATION KEY>"

# Passing to CLI
datadog-ci synthetics <command> --apiKey "<API KEY>" --appKey "<APPLICATION KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By defaut the requests are sent to Datadog US.

If the org uses a custom sub-domain to access Datadog app, it needs to be set in the `DATADOG_SUBDOMAIN` environment variable or in the global configuration file under the `subdomain` key to properly display the test results URL. As an example, if the URL used to access Datadog is `myorg.datadoghq.com` then set the environment variable to `myorg`, ie:

```bash
export DATADOG_SUBDOMAIN="myorg"
```

### API

By default it runs at the root of the working directory and finds `{,!(node_modules)/**/}*.synthetics.json` files (every files ending with `.synthetics.json` except those in the `node_modules` folder).

#### Configuration

Configuration is done via a json file, by default the tool load `datadog-ci.json` which can be overriden through the `--config` argument.

The configuration file structure is the following:

```json
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "datadogSite": "datadoghq.com",
    "files": "{,!(node_modules)/**/}*.synthetics.json",
    "global": {
        "allowInsecureCertificates": true,
        "basicAuth": { "username": "test", "password": "test" },
        "body": "{\"fakeContent\":true}",
        "bodyType": "application/json",
        "cookies": "name1=value1;name2=value2;",
        "deviceIds": ["laptop_large"],
        "executionRule": "skipped",
        "followRedirects": true,
        "headers": { "NEW_HEADER": "NEW VALUE" },
        "locations": ["aws:us-east-1"],
        "retry": { "count": 2, "interval": 300 },
        "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
        "variables": { "titleVariable": "new title" },
    },
    "pollingTimeout": 120000,
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
}
```

**Proxy configuration**

It is possible to configure a proxy to be used for outgoing connections to Datadog using the `proxy` key of the global configuration file.

As the [`proxy-agent`](https://github.com/TooTallNate/node-proxy-agent) library is used to configure the proxy, protocols supported are `http, https, socks, socks4, socks4a, socks5, socks5h, pac+data, pac+file, pac+ftp, pac+http, pac+https`. The `proxy` key of the global configuration file is passed to a new `proxy-agent` instance, meaning same configuration than the library is supported.

**Note**: `host` and `port` keys are mandatory arguments and the `protocol` key defaults to `http` if not defined.

#### Commands

The available command is:

- `run-tests`: run the tests discovered in the folder according to the `files` configuration key

It accepts the `--public-id` (or shorthand `-p`) argument to trigger only the specified test. It can be set multiple times to run multiple tests:

```bash
datadog-ci synthetics run-tests --public-id pub-lic-id1 --public-id pub-lic-id2
```

It is also possible to trigger tests corresponding to a search query by using the flag `--search` (or shorthand `-s`). With this option, the global configuration overrides applies to all tests discovered with the search query.

```bash
datadog-ci synthetics run-tests -s 'tag:e2e-tests' --config global.config.json
```

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
                "basicAuth": { "username": "test", "password": "test" },
                "body": "{\"fakeContent\":true}",
                "bodyType": "application/json",
                "cookies": "name1=value1;name2=value2;",
                "deviceIds": ["laptop_large"],
                "executionRule": "skipped",
                "followRedirects": true,
                "headers": { "NEW_HEADER": "NEW VALUE" },
                "locations": ["aws:us-east-1"],
                "pollingTimeout": 30000,
                "retry": { "count": 2, "interval": 300 },
                "startUrl": "{{URL}}?static_hash={{STATIC_HASH}}",
                "variables": { "titleVariable": "new title" },
            }
        }
    ]
}
```

The `<TEST_PUBLIC_ID>` can be either the identifier of the test found in the URL of a test details page (eg. for `https://app.datadoghq.com/synthetics/details/abc-def-ghi` it would be `abc-def-ghi`) or the full URL to the details page (ie. directly `https://app.datadoghq.com/synthetics/details/abc-def-ghi`).

All options under the `config` key allow overriding the configuration of the test as stored in Datadog.

- `allowInsecureCertificates`: (boolean) disable certificate checks in API tests.
- `basicAuth`: (object) credentials to provide in case a basic authentication is encountered.
  - `username`: (string) username to use in basic authentication.
  - `password`: (string) password to use in basic authentication.
- `body`: (string) data to send in a synthetics API test.
- `bodyType`: (string) type of the data sent in a synthetics API test.
- `cookies`: (string) use provided string as Cookie header in API or Browser test.
- `deviceIds`: (array) list of devices on which to run the Browser test.
- `executionRule`: (string) execution rule of the test: it defines the behavior of the CLI in case of a failing test, it can be either:
  - `blocking`: the CLI returns an error if the test fails.
  - `non_blocking`: the CLI only prints a warning if the test fails.
  - `skipped`: the test is not executed at all.
- `followRedirects`: (boolean) indicates whether to follow or not HTTP redirections in API tests.
- `headers`: (object) headers to replace in the test. This object should contain as keys the name of the header to replace and as values the new value of the header.
- `locations`: (array) list of locations from which the test should be run.
- `pollingTimeout`: (integer) maximum duration in milliseconds of a test, if execution exceeds this value it is considered failed.
- `retry`: (object) retry policy for the test.
  - `count`: (integer) number of attempts to perform in case of test failure.
  - `interval`: (integer) interval between the attempts (in milliseconds).
- `startUrl`: (string) new start URL to provide to the test.
- `variables`: (object) variables to replace in the test. This object should contain as keys the name of the variable to replace and as values the new value of the variable.

You can configure on which url your Browser or HTTP test starts by providing a `config.startUrl` to your test object and build your own starting url using any part of your test's original starting url and the following environment variables:

| Environment variable | Description                  | Example                                                |
|----------------------|------------------------------|--------------------------------------------------------|
| `URL`                | Test's original starting url | `https://www.example.org:81/path/to/something?abc=123` |
| `DOMAIN`             | Test's domain name           | `example.org`                                          |
| `HOST`               | Test's host                  | `www.example.org:81`                                   |
| `HOSTNAME`           | Test's hostname              | `www.example.org`                                      |
| `ORIGIN`             | Test's origin                | `https://www.example.org:81`                           |
| `PARAMS`             | Test's query parameters      | `?abc=123`                                             |
| `PATHNAME`           | Test's URl path              | `/path/to/something`                                   |
| `PORT`               | Test's host port             | `81`                                                   |
| `PROTOCOL`           | Test's protocol              | `https:`                                               |
| `SUBDOMAIN`          | Test's sub domain            | `www`                                                  |

For instance, if your test's starting url is `https://www.example.org:81/path/to/something?abc=123`

It can be written as :

* `{{PROTOCOL}}//{{SUBDOMAIN}}.{{DOMAIN}}:{{PORT}}{{PATHNAME}}{{PARAMS}}`
* `{{PROTOCOL}}//{{HOST}}{{PATHNAME}}{{PARAMS}}`
* `{{URL}}`

and so on...

### End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'
export DATADOG_APP_KEY='<application key>'

yarn launch synthetics run-tests --public-id abc-def-ghi
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
