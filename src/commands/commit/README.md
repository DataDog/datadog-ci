# Commit command

Upload the git commit details to Datadog.

## Usage

### Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By defaut the requests are sent to Datadog US. In order to send the usage metrics to the correct datacenter, the `DATADOG_API_HOST` must also be set if another instance of Datadog is used. For example, for Datadog EU, it should be set to `api.datadoghq.eu`.

It is also possible to override the full URL for the intake endpoint by defining the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

### Commands

#### `upload`

This command will upload the current commit details to Datadog in order to create links to your repositories inside DataDog's UI.

To upload the commit details, this command should be run inisde a local git repository:

```bash
datadog-ci commit upload
```

* `--repository-url` (default: empty): overrides the repository remote with a custom URL. For example: https://github.com/my-company/my-project

### End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'

yarn launch commit upload
```

Successful output should look like this:
```bash
Starting upload.
Uploading
✅ Uploaded in 1.862 seconds.
```
