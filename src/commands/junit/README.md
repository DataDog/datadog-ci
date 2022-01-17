# jUnit command

Upload your jUnit XML files.

## Usage

#### Commands

##### `upload`

This command will upload your jUnit XML test report to Datadog.

```bash
datadog-ci junit upload [--service] [--max-concurrency] [--dry-run] [--tags] <paths>
```

For example:

```bash
datadog-ci junit upload --service my-service --tags key1:value1 --tags key2:value2 unit-tests/junit-reports acceptance-tests/junit-reports e2e-tests/single-report.xml
```

- The positional arguments are the directories or file paths in which the jUnit XML reports are located. If you pass a folder, the CLI will look for all `.xml` files in it.
- `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading jUnit XML reports for.
- `--tags` is a array of key value pairs of the shape `key:value`. This will set global tags applied to all spans.
  - The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `--env` (default: `DD_ENV` env var) is a string that represents the environment where you want your tests to appear in.
- `--max-concurrency` (default: `20`): number of concurrent uploads to the API.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.

#### Environment variables

Additionally you might configure the `junit` command with environment variables:

- `DATADOG_API_KEY` or `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_ENV`: you may choose the environment you want your test results to appear in.
- `DD_SERVICE`: if you haven't specified a service through `--service` you might do it with this env var.
- `DD_TAGS`: set global tags applied to all spans. The format must be `key1:value1,key2:value2`.
  - The resulting dictionary will be merged with whatever is in the `--tags` parameter. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `DATADOG_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can use `--dry-run`:

```bash
export DATADOG_API_KEY='<API key>'

yarn launch junit upload ./src/commands/junit/__tests__/fixtures/java-report.xml --service example-upload --dry-run
```

Successful output should look like this:

```bash
⚠️ DRY-RUN MODE ENABLED. WILL NOT UPLOAD JUNIT XML
Starting upload with concurrency 20.
Will upload jUnit XML file src/commands/junit/__tests__/fixtures/java-report.xml
service: example-upload
[DRYRUN] Uploading jUnit XML test report file in src/commands/junit/__tests__/fixtures/java-report.xml
✅ Uploaded 1 files in 0 seconds.
```
