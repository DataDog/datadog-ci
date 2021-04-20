# jUnit command

Upload your jUnit XML files.

**Warning**: this command is still in alpha and should not be used in production environments.

## Usage

#### Commands

##### `upload`

This command will upload your jUnit XML test report to Datadog.

```bash
datadog-ci junit upload $PATH_TO_YOUR_XML_FOLDER
```

For example:

```bash
datadog-ci trace command mkdir ./test/junit-reports
```

- The first positional argument is the directory in which the jUnit XML reports are located. The CLI will look for all `.xml` files in this folder and subfolders recursively.

* `--service` (default: `DD_SERVICE` env var) should be set as the name of the service you're uploading jUnit XML reports for.
* `--concurrency` (default: `20`): number of concurrent upload to the API.
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.

#### Environment variables

- `DATADOG_API_KEY` (required): API key used to authenticate the request.
- `DD_ENV`: you may choose the environment you want your test results to appear in.
- `DD_SERVICE`: if you haven't specified a service through `--service` you might do it with this env var.
- `DD_TAGS`: set global tags that should be applied to all spans. The format is `key1:value1,key2:value2`.
- `DATADOG_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.
