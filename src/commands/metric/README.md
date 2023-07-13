# metric command

Add numeric tags to CI Visibility pipeline and job spans.

## Usage

```bash
datadog-ci metric [--no-fail] [--level <pipeline|job>] [--metrics]
```

For example:

```bash
datadog-ci metric --level job --metrics binary.size:1024
```

- `--level` Has to be one of `[pipeline, job]`. It will determine in what span the metrics will be added. If pipeline
  is selected then the metrics will be added to the pipeline trace span. If job is selected it will be added to the
  span for the currently running job.
- `--no-fail` (default: `false`) will prevent the metric command from failing if there are issues submitting the data.
- `--metrics` is an array of key value pairs of the shape `key:value`. This will be the metrics added to the pipeline or job span.
  The `value` must be a number.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Supported providers

The metric command only works for the following CI providers: [Buildkite, CircleCI, GitHub, GitLab]. If used in
any other provider it will fail. Note that for GitHub actions only the level `pipeline` is supported. If the
command is invoked in GitHub actions with level `job` it will exit with status code 1 and return an
error.

### End-to-end testing process

To verify this command works as expected, you can tag a mock pipeline and validate the command returns 0:

```bash
export DD_API_KEY='<API key>'
export BUILDKITE=true
export BUILDKITE_BUILD_ID=uuid

yarn launch metric --level pipeline --metrics foo:1
```

Successful output should look like this:

```bash
Metrics sent
```

