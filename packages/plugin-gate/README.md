# GATE command

=> ⚠️ **Deprecation Warning**
>
> Datadog Quality Gates is being replaced by the new PR Gates in January, 2026. Please initiate the migration process by filling out this form: https://forms.gle/qnhANsE1ABtHrjqz9
>
> Learn more about PR Gates: https://docs.datadoghq.com/pr_gates

Evaluate Quality Gates rules in Datadog. The exit status of the command will change depending on the result of the gate evaluation.

## Usage

### Commands

#### `evaluate`

The `evaluate` command evaluates the matching Quality Gates rules in Datadog.

```bash
datadog-ci gate evaluate [--scope] [--tags] [--dry-run] [--fail-if-unavailable] [--fail-on-empty] [--no-wait]
```

For example:

```bash
datadog-ci gate evaluate --scope team:backend --scope team:frontend --fail-on-empty
```

- `--scope` is an array of key value pairs of the form `key:value`. This parameter sets additional scope when retrieving matching rules. Only the rules matching the scope provided will be evaluated.
- `--tags` is an array of key value pairs of the form `key:value`. This parameter sets global tags that are applied to all results. The upload process merges the tags passed on the command line with the tags in the `DD_TAGS` environment variable. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--dry-run` runs the command without the final evaluation step. All other checks are performed. The default value is `false`.
- `--fail-if-unavailable` fails the command if Datadog is unavailable. The default value is `false`.
- `--fail-on-empty` fails the command if no matching rules are found in Datadog. The default value is `false`.
- `--timeout` is the command timeout in seconds. The default value is `600`.
- `--no-wait` removes the waiting time (30s) that is in place to ensure that events (for example: tests) can be properly queried by the rules. This mechanism prevents rules from being incorrectly evaluated due to the absence of events. Read more on the quality gates documentation before passing this flag. The default value is `false`.


### Environment variables

Additionally, you can configure the `gate` command with the following environment variables:

- `DD_API_KEY` (**required**): The API key used to authenticate the requests.
- `DD_APP_KEY` (**required**): The application key used to authenticate the requests.
- `DD_TAGS`: Sets global tags applied to all spans. The format must be `key1:value1,key2:value2`. The upload process merges the tags passed on the command line with the tags in the `--tags` parameter. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `DD_SITE`: Your Datadog site, for example, datadoghq.com or datadoghq.eu.

### Dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify the command works as expected, use `--dry-run`:

```bash
export DD_API_KEY='<API key>'
export DD_APP_KEY='<App key>'

yarn launch gate evaluate --scope team:backend --dry-run
```

Successful output looks like the example below:

```bash
ℹ️ Evaluating rules matching the following information:
Repository: git@github.com:DataDog/datadog-ci.git
Branch: master
team: backend

Dry run mode is enabled. Not evaluating the rules.
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Quality Gates][1]
- [Learn about PR Gates][2]

[1]: https://docs.datadoghq.com/quality_gates/
[2]: https://docs.datadoghq.com/pr_gates
