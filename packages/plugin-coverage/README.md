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
- `--ignored-paths` a comma-separated list of paths to skip while the directories you passed are searched for coverage report files. Glob patterns are supported, and a path matches if it appears anywhere in the file path. It does not apply to report files you passed explicitly. This filters **coverage report files** on your machine, and has no effect on which source files are covered.
- `--ignored-source-paths` a list of **source file** patterns to exclude from the coverage computation. This is the command-line equivalent of the `ignore` list in `code-coverage.datadog.yml`, and it **replaces** that list for this upload (the two are not merged). See [Ignoring source paths](#ignoring-source-paths) below.
- `--base-path` a string specifying the base (relative to repository root) for the file paths inside the coverage reports. If not specified, the paths inside the reports are considered relative to repository root.
- `--flags` (repeatable): flags to mark coverage reports for grouping and filtering (e.g., `type:unit-tests`, `jvm-21`). Maximum 32 flags per report. Can be specified multiple times: `--flags type:unit-tests --flags jvm-21`.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--verbose` (default: `false`): it will add extra verbosity to the output of the command.
- `--upload-git-diff` (default: `true`): if the command is run in a PR context, it will try to upload the PR git diff along with the coverage data.
- `--skip-git-metadata-upload` (default: `false`): skip the upload of git metadata.
- `--git-repository-url` is a string specifying the repository URL to retrieve git metadata from. If this is missing, the URL is retrieved from the local git repository.
- `--disable-file-fixes` (default: `false`): disable the generation and upload of file fixes for code coverage.
- `--file-fixes-search-path` is a string specifying the root directory used to scan source files for file fixes. By default, the repository root is used. This is useful for monorepos or when coverage reports only cover a subset of the codebase.

#### Ignoring source paths

`--ignored-source-paths` excludes source files from the coverage computation, exactly like the `ignore` list of `code-coverage.datadog.yml`. Patterns are matched server-side, so they are sent verbatim and are never expanded against your local filesystem.

```bash
datadog-ci coverage upload --ignored-source-paths "**/generated/**,src/gen/**" .
```

- Patterns are separated by commas or newlines. Commas inside a brace group are **not** separators, so `**/*.{js,ts}` and regex quantifiers such as `.{2,4}` can be used as-is. A newline-separated list is convenient for long lists passed through `DD_COVERAGE_IGNORED_SOURCE_PATHS`.
- Only brace groups protect a comma. A comma inside a character class is still a separator, so a pattern like `^src/[a,b]/.*$` is split in two; write it as `^src/[ab]/.*$`, or put it in `code-coverage.datadog.yml`. The same applies to any other pattern that needs a literal comma outside a brace group.
- The list **replaces** the `ignore` list of `code-coverage.datadog.yml` for this upload; the two are not merged. When the option is not passed (or its value contains no patterns, for instance because the environment variable is unset), the configured `ignore` list applies as usual.
- Scope is per-upload: the list only affects the reports uploaded by this invocation.
- Up to 2,000 patterns, 1,000 characters per pattern, and 256 KB in total are accepted; anything larger fails with an error naming what was exceeded. Which limit you meet first depends on the platform: on Linux and Windows the operating system refuses an oversized value before the 256 KB limit is reached, while on macOS the 256 KB limit is the one that applies (see below). Above 1,000 patterns or 100 KB the upload still happens and the command prints a warning. The per-pattern limit matches the backend's, so a pattern that would be silently discarded there is rejected here instead — otherwise discarding the last pattern would empty the list and quietly bring the configured `ignore` list back.
- The operating system may reject an oversized value before `datadog-ci` runs, and what it limits differs per platform:
  - **Linux**: 128 KB for any single argument or environment variable (`MAX_ARG_STRLEN`). Exceeding it fails with `Argument list too long`, and the environment variable is bound by the same limit, so it is not a way around it.
  - **macOS**: no per-argument limit. Arguments and the entire environment share one budget, so a large CI environment leaves less room for the list. On current versions that budget is generous enough that the 256 KB limit above is what you meet first.
  - **Windows**: 32,767 characters for the whole command line, and only 8,191 through `cmd.exe` — which is what the `npm`/`yarn` shims use, so 8,191 is the practical limit.

  Use `code-coverage.datadog.yml` for lists that approach these. For scale, 500 patterns of 80 characters is about 40 KB, well inside every platform's limit.
- Do not confuse this with `--ignored-paths`, which excludes coverage *report files* from local reports discovery.

#### Environment variables

Additionally, you might configure the `coverage` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_COVERAGE_IGNORED_SOURCE_PATHS`: the equivalent of `--ignored-source-paths`.
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
