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

* `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading jUnit XML reports for.
* `--tags` is a array of key value pairs of the shape `key:value`.
* `--concurrency` (default: `20`): number of concurrent upload to the API.
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.

#### Environment variables

Additionally you might configure the `junit` command with environment variables:

- `DATADOG_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_ENV`: you may choose the environment you want your test results to appear in.
- `DD_SERVICE`: if you haven't specified a service through `--service` you might do it with this env var.
- `DD_TAGS`: set global tags applied to all spans. The format must be `key1:value1,key2:value2`.
- `DATADOG_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.
