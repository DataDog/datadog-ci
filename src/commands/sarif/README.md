# SARIF command

Upload your SARIF report files.

## Usage

### Commands

#### `upload`

The `upload` command uploads your SARIF report to Datadog.

```bash
datadog-ci sarif upload [--max-concurrency] [--dry-run] [--no-verify] [--tags] <paths>
```

For example:

```bash
datadog-ci sarif upload --tags key1:value1 --tags key2:value2 sarif-reports/go-reports sarif-reports/java-reports sarif-report/single-report.sarif
```

The positional arguments are the directories or file paths in which the SARIF reports are located. If you pass a folder, the CLI looks for all `.sarif` files in it.
- `--tags` is a array of key value pairs of the form `key:value`. This parameter sets global tags applied to all results. The upload process merges the tags passed on the command line with the tags in the `DD_TAGS` environment variable. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--max-concurrency` (default: `20`): number of concurrent uploads to the API.
- `--dry-run` (default: `false`): runs the command without the final upload step. All other checks are performed.
- `--no-verify` (default: `false`): runs the command without performing report validation on the CLI.

### Environment variables

Additionally, you may configure the `sarif` command with environment variables:

- `DATADOG_API_KEY` or `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: Set global tags applied to all spans. The format must be `key1:value1,key2:value2`. The upload process merges the tags passed on the command line with the tags in the `--tags` parameter. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `DATADOG_SITE` or `DD_SITE`: choose your Datadog site, for example, datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify the command works as expected, use `--dry-run`:

```bash
export DATADOG_API_KEY='<API key>'

yarn launch sarif upload ./src/commands/sarif/__tests__/fixtures/valid-results.sarif --dry-run
```

Successful output looks like the example below:

```bash
⚠️ DRY-RUN MODE ENABLED. WILL NOT UPLOAD SARIF REPORT
Starting upload with concurrency 20.
Will upload SARIF report file src/commands/sarif/__tests__/fixtures/valid-results.sarif
[DRYRUN] Uploading SARIF report in src/commands/sarif/__tests__/fixtures/valid-results.sarif
✅ Uploaded 1 files in 0 seconds.
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis/
