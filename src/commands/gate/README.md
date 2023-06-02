# GATE command

Evaluate Quality Gates rules in Datadog.

## Usage

### Commands

#### `evaluate`

The `evaluate` command evaluates the matching Quality Gates rules in Datadog.

```bash
datadog-ci gate evaluate [--scope] [--tags] [--dry-run] [--fail-if-unavailable] [--fail-on-empty]
```

For example:

```bash
datadog-ci gate evaluate --scope team:backend --scope team:frontend --fail-on-empty
```

- `--scope` is an array of key value pairs of the form `key:value`. This parameter sets additional scope when retrieving matching rules. Only the rules matching the scope provided will be evaluated.
- `--tags` is an array of key value pairs of the form `key:value`. This parameter sets global tags applied to all results. The upload process merges the tags passed on the command line with the tags in the `DD_TAGS` environment variable. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `--dry-run` (default: `false`): runs the command without the final evaluation step. All other checks are performed.
- `--fail-if-unavailable` (default: `false`): fails the command if there is unavailability on the Datadog side.
- `--fail-on-empty` (default: `false`): fails the command if no matching rules were found in Datadog.

### Environment variables

Additionally, you may configure the `gate` command with environment variables:

- `DATADOG_API_KEY` or `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DATADOG_APP_KEY` (**required**): APP key used to authenticate the requests.
- `DD_TAGS`: Set global tags applied to all spans. The format must be `key1:value1,key2:value2`. The upload process merges the tags passed on the command line with the tags in the `--tags` parameter. If a key appears in both `--tags` and `DD_TAGS`, the value in `DD_TAGS` takes precedence.
- `DATADOG_SITE`: choose your Datadog site, for example, datadoghq.com or datadoghq.eu.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository metadata.

### End-to-end testing process

To verify the command works as expected, use `--dry-run`:

```bash
export DATADOG_API_KEY='<API key>'
export DATADOG_APP_KEY='<APP key>'

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
