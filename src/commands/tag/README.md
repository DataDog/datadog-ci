# tag command

Tag CI Visibility pipeline and job spans.

## Usage

```bash
datadog-ci tag [--no-fail] [--level <pipeline|job>] [--tags]
```

For example:

```bash
datadog-ci tag --level job --tags "go.version:`go version`"
```

- `--level` Has to be one of `[pipeline, job]`. It will determine in what span the tags will be added. If pipeline
  is selected then the tags will be added to the pipeline trace span. If job is selected it will be added to the
  span for the currently running job.
- `--no-fail` (default: `false`) will prevent the tag command from failing if there are issues submitting the data.
- `--tags` is an array of key value pairs of the shape `key:value`. This will be the tags added to the pipeline or job span.
  The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable and in the `--tags-file` argument.
- `--tags-file` is a file path to a JSON file that contains the tags in the form:
  ```json
  {
    "key1": "value1",
    "key2": "value2"
  }
  ```
  The JSON should be flat (without nested objects or arrays) and the keys and values should be strings.
  The resulting dictionary will be merged with whatever is in the `DD_TAGS` environment variable and in the `--tags` argument.
- `--silent` (default: `false`) will prevent the tag command from writing to stdout and stderr.

If a `key` is present in multiple sources, the order of precedence is:
1. Environment variable `DD_TAGS`
2. `--tags` argument
3. `--tags-file` argument

For example: if we define `key:foo` in the argument `--tags` and `key:bar` in the environment variable `DD_TAGS`, the value sent to Datadog is `key:bar` since `DD_TAGS` takes precedence.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: set tags applied to the pipeline or job span. The format must be `key1:value1,key2:value2`.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Supported providers

The tag command only works for the following CI providers: Buildkite, CircleCI, GitHub, GitLab, Azure Pipelines and Jenkins. If used in
any other provider it will fail.

### End-to-end testing process

To verify this command works as expected, you can tag a mock pipeline and validate the command returns 0:

```bash
export DD_API_KEY='<API key>'
export BUILDKITE=true
export BUILDKITE_BUILD_ID=uuid

bun launch tag --level pipeline --tags foo:bar
```

Successful output should look like this:

```bash
Tags sent
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Adding Custom Tags and Measures to Pipeline Traces][1]

[1]: https://docs.datadoghq.com/continuous_integration/pipelines/custom_tags_and_measures/
