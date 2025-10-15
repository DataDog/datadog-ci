# measure command

Add numeric tags to CI Visibility pipeline and job spans.

## Usage

```bash
datadog-ci measure [--no-fail] [--level <pipeline|job>] [--measures]
```

For example:

```bash
datadog-ci measure --level job --measures binary.size:1024
```

- `--level` Has to be one of `[pipeline, job]`. It will determine in what span the measures will be added. If pipeline
  is selected then the measures will be added to the pipeline trace span. If job is selected it will be added to the
  span for the currently running job.
- `--no-fail` (default: `false`) will prevent the measure command from failing if there are issues submitting the data.
- `--measures` is an array of key value pairs of the shape `key:value`. This will be the measures added to the pipeline or job span.
  The `value` must be a number
- `--measures-file` is a path to a file containing the measures to be added to the pipeline or job span. The file should be a JSON file with the following structure:
  ```json
  {
    "image.size": 5000,
    "another_measure": 123
  }
  ```
  The JSON should be flat (without nested objects or arrays) and the values should be numbers.
  If a measure is present in both the `--measures` and the `--measures-file` command line arguments, the value from the `--measures` argument takes precedence.
- `--dry-run` (default: `false`): will run the command without sending a request. All other checks are performed.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Supported providers

The measure command only works for the following CI providers: Buildkite, CircleCI, GitHub, GitLab, Azure Pipelines and Jenkins. If used in
any other provider it will fail.

### End-to-end testing process

To verify this command works as expected, you can tag a mock pipeline and validate the command returns 0:

```bash
export DD_API_KEY='<API key>'
export BUILDKITE=true
export BUILDKITE_BUILD_ID=uuid

yarn launch measure --level pipeline --measures foo:1
```

Successful output should look like this:

```bash
Measures sent
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Adding Custom Tags and Measures to Pipeline Traces][1]

[1]: https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/
