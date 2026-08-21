You can use the CLI to instrument your AWS ECS Fargate task definitions with Datadog. The command adds the Datadog Agent as a sidecar container and registers a new task definition revision, so your application containers and images are left untouched.

## Commands

### `instrument`

Run `datadog-ci ecs-fargate instrument` to add the Datadog Agent sidecar to an ECS Fargate task definition. The command reads the task definition you name, adds the `datadog-agent` container to it, and registers the result as a new revision. It never changes a running service: deploy the new revision to roll the change out.

```bash
# Instrument a task definition, reading the API key from an AWS Secrets Manager secret
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument a specific revision, or a full task definition ARN
datadog-ci ecs-fargate instrument --task-definition my-app:3 -r us-east-1 --api-key-secret-arn <secret-arn>

# Preview the changes without registering a revision
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> --dry-run
```

Running the command twice is safe: the Agent container is matched by name, so an already instrumented task definition is reported as such and no revision is registered. Each revision the command registers is tagged `dd_sls_ci` with the version of `datadog-ci` that created it; upgrading the CLI does not on its own produce a new revision, since that tag is not part of the comparison.

### Configuration

#### AWS credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html#envvars-list) configured with access to the ECS actions `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, and `ecs:TagResource`. The last one is required because the new revision is registered with tags: the ones the task definition already had, plus `dd_sls_ci`.

#### Datadog API key

Pass `--api-key-secret-arn` with the ARN of an AWS Secrets Manager secret holding your [Datadog API key](https://app.datadoghq.com/organization-settings/api-keys). The Agent reads the key from the secret at runtime, which keeps it out of the task definition. The task's execution role needs `secretsmanager:GetSecretValue` on that secret.

If you do not pass `--api-key-secret-arn`, the command falls back to the `DD_API_KEY` environment variable and writes its value into the task definition in plain text, which it warns about.

#### Environment variables

- `DD_API_KEY` (or `DATADOG_API_KEY`): the Datadog API key to write into the task definition, used only when `--api-key-secret-arn` is not passed.
- `DD_SITE` (or `DATADOG_SITE`): the [Datadog site](https://docs.datadoghq.com/getting_started/site/) to send data to. Defaults to `datadoghq.com`.
- `AWS_REGION` (or `AWS_DEFAULT_REGION`): the region to use when `--region` is not passed.

### Arguments

| Argument               | Shorthand | Description                                                                           | Default |
| ---------------------- | --------- | ------------------------------------------------------------------------------------- | ------- |
| `--task-definition`    |           | The family, `family:revision`, or ARN of the task definition to instrument. Required. |         |
| `--region`             | `-r`      | The AWS region the task definition lives in.                                          |         |
| `--api-key-secret-arn` |           | The ARN of the AWS Secrets Manager secret holding your Datadog API key.               |         |
| `--profile`            |           | The AWS named profile to read credentials from.                                       |         |
| `--dry-run`            | `-d`      | Preview the changes without registering a new revision.                               | `false` |
