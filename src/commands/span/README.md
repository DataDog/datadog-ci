# span command

Report a custom span to Datadog with name, start / end time or duration, tags and measures.

## Usage

```bash
datadog-ci span [--name <name>] [--start-time <ms>] [--end-time <ms>] [--duration <ms>] [--tags] [--measures] [--dry-run]
```

For example:

```bash
datadog-ci span --name "Say Hello" --duration 800 --tags responded-hello-too:true

```

- `--name` is a human-friendly name for the reported span.
- `--start-time` the span start time in milliseconds.
- `--end-time` the span end time in milliseconds.
- `--duration` is the duration of the span in milliseconds. If duration is provided instead of `--start-time` and `--end-time`, the end time will be the current time when executing the command (note that this method is less precise than using start / end times since launching the datadog-ci process takes some overhead).
- `--tags` is an array of key-value pairs with the format `key:value`. These tags are added to the custom span.
    The resulting dictionary is merged with what is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--measures` is an array of key-value pairs with the format `key:value`. These measures are added to the custom span.
    The `value` must be a number.
- `--dry-run` (default: `false`) runs the command without sending the custom span. All other checks are performed.

#### Environment variables

Additionally you might configure the `span` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: set global tags applied to all spans. The format must be `key1:value1,key2:value2`.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can launch the command with a dry run and validate the command returns 0:

```bash
export DD_API_KEY='<API key>'
export CIRCLECI=true

GITLAB_CI=1 yarn launch span --name hello --duration 618 --dry-run
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Adding Custom Commands to Pipeline Traces][1]

[1]: https://docs.datadoghq.com/continuous_integration/pipelines/custom_commands/
