# Code coverage upload command

Upload your code coverage report files.

## Usage

### Commands

#### `upload`

This command uploads your code coverage reports to Datadog.

```bash
datadog-ci coverage upload [--dry-run] [--tags] <path> <another_path>
```

For example:

```bash
datadog-ci coverage upload --tags key1:value1 --tags key2:value2 unit-tests/coverage-reports acceptance-tests/coverage-reports e2e-tests/coverage-report.xml
```

- The positional arguments are directories, files, or glob patterns that will be used when looking for coverage report files. If you pass a folder, the CLI will do a recursive search looking for supported coverage reports.
- `--ignored-paths` a comma-separated list of paths that should be excluded from automatic reports discovery (only applicable when `--auto-discovery` is set). Glob patterns are supported.
- `--base-path` a string specifying the base (relative to repository root) for the file paths inside the coverage reports. If not specified, the paths inside the reports are considered relative to repository root.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--verbose` (default: `false`): it will add extra verbosity to the output of the command.
- `--upload-git-diff` (default: `true`): if the command is run in a PR context, it will try to upload the PR git diff along with the coverage data.
- `--skip-git-metadata-upload` (default: `false`): skip the upload of git metadata.
- `--git-repository-url` is a string specifying the repository URL to retrieve git metadata from. If this is missing, the URL is retrieved from the local git repository.

#### Environment variables

Additionally, you might configure the `coverage` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: set global tags applied to all coverage report spans. The format must be `key1:value1,key2:value2`.
  - The resulting dictionary will be merged with whatever is in the `--tags` parameter. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `DD_MEASURES`: set global numerical tags applied to all coverage report spans. The format must be `key1:123,key2:321`.
  - The resulting dictionary will be merged with whatever is in the `--measures` parameter. If a `key` appears both in `--measures` and `DD_MEASURES`, whatever value is in `DD_MEASURES` will take precedence.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.
- `DD_SUBDOMAIN`: if you have a [custom sub-domain enabled](https://docs.datadoghq.com/account_management/multi_organization/#custom-sub-domains) for your organization, this value should be set with the subdomain so that the link to the Datadog Application that the library logs once the upload finishes is accurate.

### End-to-end testing process

To verify this command works as expected, you can use `--dry-run`:

```bash
export DD_API_KEY='<API key>'

yarn launch coverage upload --dry-run ./packages/plugin-coverage/src/__tests__/fixtures/jacoco-report.xml 
```

Successful output should look like this:

```bash
⚠️ DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT
Starting upload.
Will upload code coverage report file packages/plugin-coverage/src/__tests__/fixtures/jacoco-report.xml
[DRYRUN] Uploading code coverage report file in packages/plugin-coverage/src/__tests__/fixtures/jacoco-report.xml
✅ Uploaded 1 files in 0 seconds.
```


## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Datadog Code Coverage][1]

[1]: https://docs.datadoghq.com/code_coverage/
