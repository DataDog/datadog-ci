# Code coverage upload command

Upload your code coverage report files.

## Usage

#### Commands

##### `upload`

This command uploads your code coverage reports to Datadog.

```bash
datadog-ci coverage upload [--dry-run] [--tags] <path> <another_path>
```

For example:

```bash
datadog-ci coverage upload --tags key1:value1 --tags key2:value2 unit-tests/coverage-reports acceptance-tests/coverage-reports e2e-tests/coverage-report.xml
```

- The positional arguments are the directories or file paths in which the code coverage reports are located. If you pass a folder, the CLI will look for all `.xml` files in it.
- `--tags` is an array of key value pairs of the shape `key:value`. This will set global tags applied to all coverage reports.
  - The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `--measures` is an array of key numerical value pairs of the shape `key:123`. This will set global measures applied to all coverage reports.
  - The resulting dictionary will be merged with whatever is in the `DD_MEASURES` environment variable. If a `key` appears both in `--measures` and `DD_MEASURES`, whatever value is in `DD_MEASURES` will take precedence.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--skip-git-metadata-upload` (default: `true`): if you want to upload git metadata, you may pass `--skip-git-metadata-upload=0` or `--skip-git-metadata-upload=false`.
- `--verbose` (default: `false`): it will add extra verbosity to the output of the command.

#### Environment variables

Additionally, you might configure the `coverage` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: set global tags applied to all test spans. The format must be `key1:value1,key2:value2`.
  - The resulting dictionary will be merged with whatever is in the `--tags` parameter. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `DD_MEASURES`: set global numerical tags applied to all test spans. The format must be `key1:123,key2:321`.
  - The resulting dictionary will be merged with whatever is in the `--measures` parameter. If a `key` appears both in `--measures` and `DD_MEASURES`, whatever value is in `DD_MEASURES` will take precedence.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.
- `DD_SUBDOMAIN`: if you have a [custom sub-domain enabled](https://docs.datadoghq.com/account_management/multi_organization/#custom-sub-domains) for your organization, this value should be set with the subdomain so that the link to the Datadog Application that the library logs once the upload finishes is accurate.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can use `--dry-run`:

```bash
export DD_API_KEY='<API key>'

yarn launch coverage upload --dry-run ./src/commands/coverage/__tests__/fixtures/jacoco-report.xml 
```

Successful output should look like this:

```bash
⚠️ DRY-RUN MODE ENABLED. WILL NOT UPLOAD COVERAGE REPORT
Starting upload.
Will upload ode coverage report file src/commands/coverage/__tests__/fixtures/jacoco-report.xml
[DRYRUN] Uploading code coverage report file in src/commands/coverage/__tests__/fixtures/jacoco-report.xml
✅ Uploaded 1 files in 0 seconds.
```


## Further reading

- TODO: Add link to the documentation page
- TODO: Add link to the documentation page in main README beta section
