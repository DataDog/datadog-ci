# jUnit command

Upload your jUnit XML files.

**Warning**: this command is still in alpha and should not be used in production environments.

## Usage

#### Commands

##### `upload`

This command will upload your jUnit XML test report to Datadog.

```bash
datadog-ci junit upload [--service] [--concurrency] [--dry-run] [--tags] <paths>
```

For example:

```bash
datadog-ci junit upload --service my-service --tags key1:value1 --tags key2:value2 unit-tests/junit-reports acceptance-tests/junit-reports
```

- The positional arguments are the directories in which the jUnit XML reports are located. The CLI will look for all `.xml` files in these folders and subfolders recursively.

- `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading jUnit XML reports for.
- `--tags` is a array of key value pairs of the shape `key:value`. This will set global tags applied to all spans.
  - The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `--concurrency` (default: `20`): number of concurrent uploads to the API.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.

#### Environment variables

Additionally you might configure the `junit` command with environment variables:

- `DATADOG_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_ENV`: you may choose the environment you want your test results to appear in.
- `DD_SERVICE`: if you haven't specified a service through `--service` you might do it with this env var.
- `DD_TAGS`: set global tags applied to all spans. The format must be `key1:value1,key2:value2`.
  - The resulting dictionary will be merged with whatever is in the `--tags` parameter. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `DATADOG_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can send some mock data and validate the command returns 0:

```bash
export DATADOG_API_KEY='<API key>'

yarn launch junit upload /src/commands/junit/__tests__/fixtures --service example-upload
```

Successful output should look like this:

```bash
Starting upload with concurrency 20.
Will look for jUnit XML files in src/commands/junit/__tests__/fixtures
service: example-upload
Uploading jUnit XML test report file in src/commands/junit/__tests__/fixtures/go-report.xml
Uploading jUnit XML test report file in src/commands/junit/__tests__/fixtures/java-report.xml
✅ Uploaded 2 files in ? seconds.
```
