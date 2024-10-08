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

**Important**: This command does not work for every setup. Refer to [when to call the command](#When-to-call-the-command) for more details.

#### When to call the command

In order for the command to work properly, it needs to be called between when the configuration changes are committed and when they are pushed to the configuration repository (where the Kubernetes manifests are). The flow should be similar to the following:

1. Make the changes to the configuration (for example, update a image tag).
2. Run `git commit -m "update kubernetes configuration"`.
3. Run `datadog-ci deployment correlate --provider <cd_provider>` (refer to the command syntax below).
4. Run `git push`.

If you are using [argo cd image updater][3], this command does not work since it relies on making the changes using `git commit`. 

Again, these steps need to happen in your CI since the end goal of this command is to correlate the pipeline doing the configuration changes
with the associated deployments.

For example:
```bash
datadog-ci deployment correlate --provider argocd
```

- `--provider` (**required**): the CD provider name. Currently, the only supported CD provider is `argocd`.
- `--config-repo`: configuration repository URL where the kubernetes manifests are stored. If empty, the command tries to get it using the git command `git ls-remote --get-url`.
- `--dry-run` (default: `false`): prevents the command from sending any data to Datadog. All the other checks are still performed.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_SITE`: choose your Datadog site. For example, datadoghq.com or datadoghq.eu.

## Further reading

Additional helpful documentation, links, and articles:

- [Monitor CI providers deployments][1]
- [Learn about Continuous Delivery][2]

[1]: https://docs.datadoghq.com/continuous_delivery/deployments/ciproviders
[2]: https://docs.datadoghq.com/continuous_delivery/
[3]: https://argocd-image-updater.readthedocs.io/en/stable/
