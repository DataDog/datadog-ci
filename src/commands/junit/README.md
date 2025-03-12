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
- `--auto-discovery` (default: `false`) do a recursive search and automatic jUnit XML reports discovery in the folders provided in positional arguments.
- `--ignored-paths` a comma-separated list of paths that should be excluded from automatic reports discovery (only applicable when `--auto-discovery` is set)
- `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading jUnit XML reports for.
- `--tags` is an array of key value pairs of the shape `key:value`. This will set global tags applied to all spans.
  - The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `--measures` is an array of key numerical value pairs of the shape `key:123`. This will set global measures applied to all spans.
  - The resulting dictionary will be merged with whatever is in the `DD_MEASURES` environment variable. If a `key` appears both in `--measures` and `DD_MEASURES`, whatever value is in `DD_MEASURES` will take precedence.
- `--report-tags` is an array of key value pairs like the `--tags` argument, but the tags are only applied to the session instead of to every test.
  - The resulting dictionary will NOT be merged with `DD_TAGS`.
- `--report-measures` is an array of key numerical value pairs like the `--measures` argument, but the measures are only applied to the session instead of to every test.
  - The resulting dictionary will NOT be merged with `DD_MEASURES`.
- `--env` (default: `DD_ENV` env var) is a string that represents the environment where you want your tests to appear in.
- `--max-concurrency` (default: `20`): number of concurrent uploads to the API.
- `--dry-run` (default: `false`): it will run the command without the final upload step. All other checks are performed.
- `--logs` (default: `false`): it will enable collecting logs from the content in the XML reports.
- `--skip-git-metadata-upload` (default: `true`): if you want to upload git metadata, you may pass `--skip-git-metadata-upload=0` or `--skip-git-metadata-upload=false`.
- `--git-repository-url` is a string with the repository URL to retrieve git metadata from. If this is missing, the URL is retrieved from the local git repository.
- `--verbose` (default: `false`): it will add extra verbosity to the output of the command.

#### Environment variables

Additionally you might configure the `junit` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_ENV`: you may choose the environment you want your test results to appear in.
- `DD_SERVICE`: if you haven't specified a service through `--service` you might do it with this env var.
- `DD_TAGS`: set global tags applied to all test spans. The format must be `key1:value1,key2:value2`.
  - The resulting dictionary will be merged with whatever is in the `--tags` parameter. If a `key` appears both in `--tags` and `DD_TAGS`, whatever value is in `DD_TAGS` will take precedence.
- `DD_MEASURES`: set global numerical tags applied to all test spans. The format must be `key1:123,key2:321`.
  - The resulting dictionary will be merged with whatever is in the `--measures` parameter. If a `key` appears both in `--measures` and `DD_MEASURES`, whatever value is in `DD_MEASURES` will take precedence.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.
- `DD_CIVISIBILITY_LOGS_ENABLED`: it will enable collecting logs from the content in the XML reports.
- `DD_SUBDOMAIN`: if you have a [custom sub-domain enabled](https://docs.datadoghq.com/account_management/multi_organization/#custom-sub-domains) for your organization, this value should be set with the subdomain so that the link to the Datadog Application that the library logs once the upload finishes is accurate.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can use `--dry-run`:

```bash
export DD_API_KEY='<API key>'

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


## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Uploading JUnit test report files to Datadog][1]

[1]: https://docs.datadoghq.com/tests/setup/junit_xml/
