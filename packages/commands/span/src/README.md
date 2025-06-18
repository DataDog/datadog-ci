# Span command

Report a custom span to Datadog with name, start and end time (or duration), tags, and measures.

## Usage

```bash
datadog-ci trace span [--name <name>] [--start-time <ms>] [--end-time <ms>] [--duration <ms>] [--tags] [--measures] [--dry-run]
```

For example:

```bash
datadog-ci trace span --name "Say Hello" --duration 800 --tags responded-hello-too:true
```

- `--name` is a human-readable name for the reported span.
- `--start-time` the span start time in milliseconds since the unix epoch.
- `--end-time` the span end time in milliseconds since the unix epoch.
- `--duration` is the duration of the span in milliseconds. If duration is provided instead of `--start-time` and `--end-time`, the span end time is the current time when executing this command. This method is less precise than using start and end times since launching the datadog-ci process requires some time.
- `--tags` is an array of key-value pairs with the format `key:value`. These tags are added to the custom span.
    The resulting dictionary is merged with the contents of the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--measures` is an array of key-value pairs with the format `key:value`. These measures are added to the custom span.
    The `value` must be a number.
- `--dry-run` (default: `false`) runs the command without sending the custom span. All other checks are performed.

#### Environment variables

The `DD_API_KEY` environment variable is required for the `span` command. You can also set tags and the Datadog site:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: Global tags applied to all spans. The format must be `key1:value1,key2:value2`.
- `DD_SITE`: Your [Datadog site][2]'s `site parameter` value, for example, datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`][3] is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, run it with the `dry-run` option enabled, and validate that it returns 0:

```bash
export DD_API_KEY='<API key>'
export CIRCLECI=true

GITLAB_CI=1 yarn launch trace span --name hello --duration 618 --dry-run
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Adding Custom Commands to Pipeline Traces][1]

[1]: https://docs.datadoghq.com/continuous_integration/pipelines/custom_commands/
[2]: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
[3]: https://git-scm.com/downloads
