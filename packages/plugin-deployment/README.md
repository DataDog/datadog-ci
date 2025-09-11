# Deployment command

Contains helper commands related to CD Visibility.

## Usage

### Commands

#### `mark`

The `mark` command specifies that a CI job executes a deployment.

```bash
datadog-ci deployment mark [--env] [--revision] [--service] [--is-rollback] [--tags] [--no-fail]
```

For example:

```bash
datadog-ci deployment mark --env prod --service payment-service --revision v1.1.0 --tags team:backend --no-fail
```

- `--env` is the environment to which this deployment is performed. For example, `prod`.
- `--revision` is the revision/version that is being deployed. For example, `1.0.0` or `v123-456`.
- `--service` the name of the service being deployed. For example, `payment-service`.
- `--is-rollback` specifies that the deployment is a rollback.
- `--tags` is an array of key value pairs in the format `key:value`. These tags are added to the deployment event shown in Datadog.
- `--no-fail` (default: `false`) prevents the deployment command from failing if there are issues submitting the data.

### `correlate`

**Note**: If you are using `datadog-ci deployment mark`, then you do not need to use this command, as the correlation is made automatically.

The `correlate` command connects a GitOps deployment with the CI pipeline of the application repository. Once they are connected, you can see in Datadog's UI which pipeline
triggered a deployment, and which deployments were triggered by a pipeline.

**Important**: This command does not work for every setup. Refer to the [documentation][3] for more details.

For example:

```bash
datadog-ci deployment correlate --provider argocd
```

- `--provider` (**required**): the CD provider name. Currently, the only supported CD provider is `argocd`.
- `--config-repo`: configuration repository URL where the kubernetes manifests are stored. If empty, the command tries to get it using the git command `git ls-remote --get-url`.
- `--config-shas`: a list of the Git commit SHAs of the configuration repository. If empty, the command tries to get all local commits using a `git log` command.
- `--dry-run` (default: `false`): prevents the command from sending any data to Datadog. All the other checks are still performed.

### `correlate-image`

**Note**: This command replaces `datadog-ci deployment correlate`.

The `correlate-image` command connects an image generated on CI with a commit of the application repository. Then, when Datadog receives a deployment that deploys your image,
the deployment is correlated to the application commit. This allows for correlation between configuration and application repositories in GitOps scenarios.

**Important**: This command does not work for every setup. Refer to the [documentation][3] for more details.

For example:

```bash
datadog-ci deployment correlate-image --commit-sha c9c4e93346652f426c91a2c41364679698bc492f --repository-url https://github.com/DataDog/datadog-ci --image datadog-ci:sha@038d890a9c01bc90a634fafedbd1c2fcd05cd95f
```

- `--commit-sha` (**required**): Commit SHA to correlate with an image. Should be from the application repository.
- `--repository-url` (**required**): Repository URL for the commit SHA being correlated.
- `--image` (**required**): Image to correlate with the commit SHA.

### `gate`

The `gate` command evaluates a Deployment Gate and exits with code 0 if the gate passed or 1 if the gate failed. Refer to the [Deployment Gates documentation][4] for more details.

```bash
datadog-ci deployment gate --service --env [--identifier] [--version] [--apm-primary-tag] [--timeout] [--fail-on-error]
```

For example:

```bash
datadog-ci deployment gate --service payments-backend --env prod
```

- `--service` (**required**): Service name. For example `payments-backend`.
- `--env` (**required**): Environment name. For example `prod`.
- `--identifier` (default: `default`): Deployment Gate identifier. For example, `pre`.
- `--version` (**required** if your gate has faulty deployment detection rules): Version that is being deployed. For example, `v1.0.3`.
- `--apm-primary-tag`: APM primary tag (only for gates with faulty deployment detection rules). For example, `region:us-central-1`.
- `--timeout` (default: 10800 = 3 hours): Maximum time to wait for the script execution in seconds. For example, `3600`.
- `--fail-on-error` (default: `false`): When false, the script will consider the gate as passed and exit with code 0 when timeout is reached or unexpected errors occur. Otherwise it will consider the gate failed and exit with code 1.

The command will exit with status 0 when the gate passes and status 1 otherwise.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_APP_KEY` (**required** for `correlate-image` and `gate`): APP key used to authenticate the requests.
- `DD_SITE`: choose your Datadog site. For example, datadoghq.com or datadoghq.eu.

## Further reading

Additional helpful documentation, links, and articles:

- [Monitor CI providers deployments][1]
- [Learn about Continuous Delivery][2]

[1]: https://docs.datadoghq.com/continuous_delivery/deployments/ciproviders
[2]: https://docs.datadoghq.com/continuous_delivery/
[3]: https://docs.datadoghq.com/continuous_delivery/deployments/argocd#correlate-deployments-with-ci-pipelines
[4]: https://docs.datadoghq.com/deployment_gates/
