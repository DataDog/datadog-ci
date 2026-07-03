# trace command

Trace a command with a custom span and report it to Datadog.

## Usage

```bash
datadog-ci trace [--name <name>] [--tags] [--measures] [--no-fail] [--no-capture] [--dry-run] -- <command>
```

For example:

```bash
datadog-ci trace --name "Say Hello" -- echo "Hello World"
```

> To report a standalone span with a name and a duration (or start/end time) instead of wrapping a command, use the [`trace span`](../span) subcommand.

- The positional arguments are the command which will be launched and traced.
- `--name` (default: same as <command>) is a human-friendly name for the reported span.
- `--tags` is an array of key-value pairs with the format `key:value`. These tags are added to the custom span.
    The resulting dictionary is merged with what is in the `DD_TAGS` environment variable. If a `key` appears both in `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--measures` is an array of key-value pairs with the format `key:value`. These measures are added to the custom span.
    The `value` must be a number.
- `--no-fail` (default: `false`) will prevent the trace command from failing even when not run in a supported CI Provider. In this case, the command will be launched and nothing will be reported to Datadog.
- `--no-capture` (default: `false`) reports only the executable name instead of the full command line, so potentially sensitive arguments (tokens, secrets, etc.) are not sent to Datadog. The command is still launched with all of its arguments; only the reported span is trimmed. When `--name` is not provided, the span name also defaults to the executable name.
- `--dry-run` (default: `false`) runs the command without sending the custom span. All other checks are performed.

#### Environment variables

Additionally you might configure the `trace` command with environment variables:

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_TAGS`: set global tags applied to all spans. The format must be `key1:value1,key2:value2`.
- `DD_SITE`: choose your Datadog site, e.g. datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify this command works as expected, you can trace a mock command and validate the command returns 0:

```bash
export DD_API_KEY='<API key>'
export CIRCLECI=true

yarn launch trace --name "Say Hello" echo "Hello World"
```

Successful output should look like this:

```bash
Hello World
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Adding Custom Commands to Pipeline Traces][1]

[1]: https://docs.datadoghq.com/continuous_integration/pipelines/custom_commands/
