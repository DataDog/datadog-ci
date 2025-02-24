# DORA Metrics

Send deployment events for DORA Metrics from CI.

## Usage

### Commands

#### `deployment`

**Warning:** The `dora deployment` command is in beta. It requires you to set `DD_BETA_COMMANDS_ENABLED=1`.

This command sends details to Datadog about a deployment of a service.

```bash
$ DD_BETA_COMMANDS_ENABLED=1 datadog-ci dora deployment [--service #0] [--env #0] [--dry-run]

━━━ Options ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  --started-at #0            In Unix seconds or ISO8601. (Examples: 1699960648, 2023-11-14T11:17:28Z)
  --finished-at #0           In Unix seconds or ISO8601. (Examples: 1699961048, 2023-11-14T11:24:08Z)
  --git-repository-url #0    Example: https://github.com/DataDog/datadog-ci.git
  --git-commit-sha #0        Example: 102836a25f5477e571c73d489b3f0f183687068e
  --skip-git                 Disables sending git URL and SHA. Change Lead Time will not be available
```

For example:

```bash
export DD_BETA_COMMANDS_ENABLED=1

datadog-ci dora deployment --service my-service --env prod \
    --started-at 1699960648 --finished-at 1699961048 \
    --git-repository-url https://github.com/my-organization/my-repository \
    --git-commit-sha 102836a25f5477e571c73d489b3f0f183687068e
```

`--service` (or `DD_SERVICE`) and `--started-at` are always required and `--git-repository-url` and `--git-commit-sha` are necessary for Change Lead Time.

- `--service` (default: `DD_SERVICE` env var) should be set as the name of the service that was deployed.
- `--env` (default: `DD_ENV` env var) is a string that represents the environment that was targeted by the deployment.
- `--started-at` (required) is the timestamp in Unix seconds or ISO8601 when the deployment started.
- `--finished-at` (default: current timestamp) is the timestamp in Unix seconds or ISO8601 when the deployment finished.
- `--git-repository-url` is a string with the repository URL for the deployed service. If this is missing, the URL is retrieved from the local git repository.
- `--git-commit-sha` is a string with the git commit SHA that has been deployed. If this is missing, the current HEAD is retrieved from the local git repository.
- `--skip-git` (default: `false`): Disables sending git URL and SHA. Change Lead Time will not be available
- `--dry-run` (default: `false`): It runs the command without actually sending the event. All other checks are still performed.


#### Environment variables

Additionally, you can configure the `deployment` command with environment variables:

- `DATADOG_API_KEY` or `DD_API_KEY` (**required**): API key used to authenticate the requests. For more information about getting a Datadog API key, see the [API key documentation][2].
- `DATADOG_SITE` or `DD_SITE`: Set the [Datadog site][3]. The default is `datadoghq.com`.
- `DD_ENV`: you may choose the environment you that the deployment has targetted
- `DD_SERVICE`: If you haven't specified a service through `--service` you can set it with this env var.

### Optional dependencies

- [`git`](https://git-scm.com/downloads) is used for extracting repository URL and commit SHA automatically.

### End-to-end testing process

To verify this command works as expected, you can use `--dry-run`:

```bash
export DD_API_KEY='<API key>'
export DD_BETA_COMMANDS_ENABLED=1

yarn launch dora deployment --service test-service --started-at `date +%s` --dry-run
```

This is an example of a successful output:

```bash
⚠️ --git-repository-url or --git-commit-sha not provided.
Assuming deployment of the current HEAD commit: git@github.com:DataDog/datadog-ci.git 400beb0f276d923846cf778b9dbe9cf101306e41
This warning can be disabled with --skip-git but git data is required for Change Lead Time.
[DRYRUN] Sending DORA deployment event for service: dora-api
 data: {
  "service": "dora-api",
  "startedAt": "2023-11-14T17:14:16.000Z",
  "finishedAt": "2023-11-14T17:14:18.574Z",
  "git": {
    "repoURL": "git@github.com:DataDog/datadog-ci.git",
    "commitSHA": "400beb0f276d923846cf778b9dbe9cf101306e41"
  }
}
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about DORA Metrics][1]

[1]: https://docs.datadoghq.com/dora_metrics/
[2]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
[3]: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
