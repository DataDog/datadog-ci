# SARIF command

Upload your SARIF report files.

## Usage

#### Commands

##### `upload`

This command will upload your SARIF report to Datadog.

```bash
datadog-ci sarif upload [--service] [--max-concurrency] [--dry-run] [--no-verify] [--tags] <paths>
```

For example:

```bash
datadog-ci sarif upload --service my-service --tags key1:value1 --tags key2:value2 sarif-reports/go-reports sarif-reports/java-reports sarif-report/single-report.sarif
```

- The positional arguments are the directories or file paths in which the SARIF reports are located. If you pass a folder, the CLI will look for all `.sarif` files in it.
- `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading SARIF reports for.
- `--tags` is a array of key value pairs of the shape `key:value`. This will set global tags applied to all results.
  - The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `--env` (default: `DD_ENV` env var) is a string that represents the environment where you want your tests to appear in.
- `--max-concurrency` (default: `20`): number of concurrent uploads to the API.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--no-verify` (default: `false`): it will run the command without performing reports validation on the CLI.

#### Environment variables

Additionally you might configure the `sarif` command with environment variables:

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

yarn launch sarif upload ./src/commands/sarif/__tests__/fixtures/valid-results.sarif --service example-upload --dry-run
```

Successful output should look like this:

```bash
⚠️ DRY-RUN MODE ENABLED. WILL NOT UPLOAD SARIF REPORT
Starting upload with concurrency 20.
Will upload SARIF report file src/commands/sarif/__tests__/fixtures/valid-results.sarif
service: example-upload
[DRYRUN] Uploading SARIF report in src/commands/sarif/__tests__/fixtures/valid-results.sarif
✅ Uploaded 1 files in 0 seconds.
```
