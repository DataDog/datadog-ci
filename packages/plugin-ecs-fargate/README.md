You can use the CLI to instrument your AWS ECS Fargate task definitions with Datadog. The command adds the Datadog Agent as a sidecar container, gives the application containers the environment their tracers read, and registers a new task definition revision. Your container images are left untouched.

## Commands

### `instrument`

Run `datadog-ci ecs-fargate instrument` to add the Datadog Agent sidecar to an ECS Fargate task definition. The command reads the task definitions you name, adds the `datadog-agent` container to each of them, and registers the result as a new revision. It never changes a running service: deploy the new revision to roll the change out.

```bash
# Instrument a task definition, reading the API key from an AWS Secrets Manager secret
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument a specific revision, or a full task definition ARN
datadog-ci ecs-fargate instrument --task-definition my-app:3 -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument several task definitions in one run
datadog-ci ecs-fargate instrument --task-definition my-app --task-definition my-worker -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument with unified service tagging
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> \
  --service my-service --env prod --version 1.0.0

# Preview the changes without registering a revision
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> --dry-run
```

Application containers are given `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, and `DD_TAGS` from the arguments above, so the traces, logs, and metrics your tracers send are tagged consistently. `DD_SERVICE`, `DD_TRACE_ENABLED`, and `DD_LOGS_INJECTION` are only filled in when the container does not set them itself, so a task definition that has already made a choice keeps it. Everything else the command is asked for wins over what the task definition had, including an explicit `--service`.

Running the command twice is safe: the Agent container is matched by name, so an already instrumented task definition is reported as such and no revision is registered. Each revision the command registers is tagged `dd_sls_ci` with the version of `datadog-ci` that created it; upgrading the CLI does not on its own produce a new revision, since that tag is not part of the comparison.

### Configuration

#### AWS credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html#envvars-list) configured with access to the ECS actions `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, and `ecs:TagResource`. The last one is required because the new revision is registered with tags: the ones the task definition already had, plus `service`, `env`, `version`, and `dd_sls_ci`.

#### Datadog API key

Pass `--api-key-secret-arn` with the ARN of an AWS Secrets Manager secret holding your [Datadog API key](https://app.datadoghq.com/organization-settings/api-keys). The Agent reads the key from the secret at runtime, which keeps it out of the task definition. The task's execution role needs `secretsmanager:GetSecretValue` on that secret.

If you do not pass `--api-key-secret-arn`, the command falls back to the `DD_API_KEY` environment variable and writes its value into the task definition in plain text, which it warns about. A key given this way is validated against your Datadog site before anything is registered.

#### Environment variables

- `DD_API_KEY` (or `DATADOG_API_KEY`): the Datadog API key to write into the task definition, used only when `--api-key-secret-arn` is not passed.
- `DD_SITE` (or `DATADOG_SITE`): the [Datadog site](https://docs.datadoghq.com/getting_started/site/) to send data to. Defaults to `datadoghq.com`.
- `AWS_REGION` (or `AWS_DEFAULT_REGION`): the region to use when `--region` is not passed.

### Arguments

You can pass the following arguments to `instrument` to specify its behavior. `--fips` and `--fips-ignore-error` are also accepted, as they are on every command.

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Preview changes running command would apply | `false` |
| `--task-definition` or `--taskDefinition` |  | The family, family:revision, or ARN of the task definition to instrument. Can be specified multiple times. |  |
| `--region` | `-r` | The AWS region the task definition lives in |  |
| `--profile` |  | Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles |  |
| `--api-key-secret-arn` or `--apiKeySecretArn` |  | The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over DD_API_KEY, which is written to the task definition in plain text |  |
| `--agent-image` or `--sidecar-image` |  | Override to pin a specific version tag or to use a mirrored image from a custom registry (for example, ECR) to avoid pull rate limits. | `public.ecr.aws/datadog/agent:latest` |
| `--service` |  | The value for the service tag. Use this to group related tasks belonging to similar workloads. For example, `my-service`. If not provided, the task definition family is used. |  |
| `--env` or `--environment` |  | The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`. |  |
| `--version` |  | The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`. |  |
| `--extra-tags` or `--extraTags` |  | Additional tags to add to the task in the format "key1:value1,key2:value2". |  |
| `--env-vars` | `-e` | Additional environment variables to set on every container in the task. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
| `--source-code-integration` or `--sourceCodeIntegration` |  | Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` |  | Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--tracing` |  | Enables tracing of your application if the tracer is installed. Disable tracing by setting `--tracing false`. |  |
| `--log-level` or `--logLevel` |  | Specify your Datadog log level. |  |
| `--appsec` |  | Enable Application Security Monitoring for the instrumented task. | `false` |
| `--llmobs` |  | If specified, enables LLM Observability for the instrumented task with the provided ML application name. |  |
| `--config` |  | Path to the configuration file. |  |
<!-- END_USAGE:instrument -->

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and run `datadog-ci ecs-fargate instrument --config datadog-ci.json`. A `datadog-ci.json` in the working directory is picked up automatically, without `--config`. Arguments you pass on the command line override the values in the configuration file.

```json
{
  "ecsFargate": {
    "taskDefinitions": ["my-app", "my-worker"],
    "region": "us-east-1",
    "apiKeySecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:dd-api-key",
    "service": "my-service",
    "environment": "prod",
    "version": "1.0.0",
    "extraTags": "team:backend,project:api",
    "envVars": ["CUSTOM_VAR1=value1", "CUSTOM_VAR2=value2"]
  }
}
```

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).
