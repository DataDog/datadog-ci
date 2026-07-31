# Code coverage upload command

Upload your code coverage report files.

## Usage

### Commands

#### `upload`

This command uploads your code coverage reports to Datadog.

```bash
datadog-ci coverage upload [--dry-run] [--flags] <path> <another_path>
```

For example:

```bash
datadog-ci coverage upload --flags type:unit-tests --flags jvm-21 unit-tests/coverage-reports acceptance-tests/coverage-reports e2e-tests/coverage-report.xml
```

- The positional arguments are directories, files, or glob patterns that will be used when looking for coverage report files. If you pass a folder, the CLI will do a recursive search looking for supported coverage reports.
- `--ignored-paths` a comma-separated list of paths that should be excluded from automatic reports discovery (only applicable when `--auto-discovery` is set). Glob patterns are supported.
- `--base-path` a string specifying the base (relative to repository root) for the file paths inside the coverage reports. If not specified, the paths inside the reports are considered relative to repository root.
- `--flags` (repeatable): flags to mark coverage reports for grouping and filtering (e.g., `type:unit-tests`, `jvm-21`). Maximum 32 flags per report. Can be specified multiple times: `--flags type:unit-tests --flags jvm-21`.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--verbose` (default: `false`): it will add extra verbosity to the output of the command.
- `--upload-git-diff` (default: `true`): if the command is run in a PR context, it will try to upload the PR git diff along with the coverage data.
- `--skip-git-metadata-upload` (default: `false`): skip the upload of git metadata.
- `--git-repository-url` is a string specifying the repository URL to retrieve git metadata from. If this is missing, the URL is retrieved from the local git repository.
- `--disable-file-fixes` (default: `false`): disable the generation and upload of file fixes for code coverage.
- `--file-fixes-search-path` is a string specifying the root directory used to scan source files for file fixes. By default, the repository root is used. This is useful for monorepos or when coverage reports only cover a subset of the codebase.
- `--coverage-config` is a string specifying the path to the [code coverage configuration][2] file to upload. Use it when the configuration is generated during the CI run instead of being committed, or when it is not at one of the default locations. If the file cannot be read, the command fails without uploading anything.

#### Code coverage configuration and CODEOWNERS

The command looks for the [code coverage configuration][2] and the `CODEOWNERS` file, and uploads their
content along with the coverage reports. Both lookups are best-effort: a missing file never fails the
upload, and the command warns when no coverage configuration is found at all.

Each file is looked up in two places:

1. The files committed at the reported commit — `code-coverage.datadog.yml`, then `code-coverage.datadog.yaml`
   for the configuration, and `.github/CODEOWNERS`, `CODEOWNERS`, then `docs/CODEOWNERS` for code owners.
2. The working directory, under the repository root, then `--base-path`, then the current directory.

**The working-directory copy wins**, so a configuration generated at build time is used even when it is
not committed — which is also what `--coverage-config` is for when the generated file is somewhere else.
A file that is only committed (for example in a sparse checkout) still applies: it is read from the
repository instead of being uploaded. Files larger than 1 MiB are not uploaded; only their path and
SHA are sent.

#### Environment variables

Additionally, you might configure the `coverage` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
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
- [Code Coverage configuration][2]

[1]: https://docs.datadoghq.com/code_coverage/
[2]: https://docs.datadoghq.com/code_coverage/configuration/
