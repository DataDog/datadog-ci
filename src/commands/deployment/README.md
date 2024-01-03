# Deployment command

Marks a CI job as a deployment.

## Usage

### Commands

#### `mark`

The `mark` command specifies that a CI job executes a deployment.

```bash
datadog-ci deployment mark [--env] [--revision] [--is-rollback] [--tags] [--no-fail]
```

For example:

```bash
datadog-ci deployment mark --env prod --revision v1.1.0 --tags team:backend --no-fail
```

- `--env` is the environment to which this deployment is performed. For example, `prod`.
- `--revision` is the revision/version that is being deployed. For example, `1.0.0` or `v123-456`.
- `--is-rollback` specifies that the deployment is a rollback.
- `--tags` is an array of key value pairs in the format `key:value`. These tags are added to the deployment event shown in Datadog.
- `--no-fail` (default: `false`) will prevent the deployment command from failing if there are issues submitting the data.

### Environment variables

- `DD_API_KEY` (**required**): API key used to authenticate the requests.
- `DD_SITE`: choose your Datadog site. For example, datadoghq.com or datadoghq.eu.

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Continuous Delivery][1]

[1]: https://docs.datadoghq.com/continuous_delivery/
