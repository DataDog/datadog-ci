You can use the CLI to instrument your AWS ECS Fargate task definitions with Datadog. The command adds the Datadog Agent as a sidecar container, gives the application containers the environment their tracers read, and registers a new task definition revision. Your container images are left untouched.

## Commands

### `instrument`

**Warning:** The `ecs-fargate instrument` command is in beta. It requires you to set `DD_BETA_COMMANDS_ENABLED=1`.

Run `datadog-ci ecs-fargate instrument` to add the Datadog Agent sidecar to an ECS Fargate task definition. The command reads the task definitions you name, adds the `datadog-agent` container to each of them, and registers the result as a new revision. Nothing that is running changes until the new revision is deployed, which you can leave to the command with `--ecs-service`.

```bash
export DD_BETA_COMMANDS_ENABLED=1

# Instrument a task definition, reading the API key from an AWS Secrets Manager secret
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument a specific revision, or a full task definition ARN
datadog-ci ecs-fargate instrument --task-definition my-app:3 -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument several task definitions in one run
datadog-ci ecs-fargate instrument --task-definition my-app --task-definition my-worker -r us-east-1 --api-key-secret-arn <secret-arn>

# Instrument a task definition and roll the new revision out to the service running it
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> \
  --ecs-service my-app-service --cluster my-cluster

# Instrument with unified service tagging
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> \
  --service my-service --env prod --version 1.0.0

# Send container logs to Datadog
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> \
  --log-collection

# Preview the changes without registering a revision
datadog-ci ecs-fargate instrument --task-definition my-app -r us-east-1 --api-key-secret-arn <secret-arn> --dry-run
```

Application containers are given `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, and `DD_TAGS` from the arguments above, so the traces, logs, and metrics your tracers send are tagged consistently. `DD_SERVICE`, `DD_TRACE_ENABLED`, and `DD_LOGS_INJECTION` are only filled in when the container does not set them itself, so a task definition that has already made a choice keeps it. Everything else the command is asked for wins over what the task definition had, including an explicit `--service`.

The same three values are also written to the application containers as the `com.datadoghq.tags.service`, `com.datadoghq.tags.env`, and `com.datadoghq.tags.version` Docker labels. The environment variables tag what a tracer running inside a container sends; these labels are what the Agent reads to tag the metrics it collects about the container from the outside, so the two line up in Datadog. The Agent container is deliberately left unlabelled, so that it reports its own resource usage under its own name rather than your service's. Labels already on a container are kept, and any that are not Datadog's are left alone.

#### Reaching the Agent

The tracers reach the Agent over a Unix socket by default. The command adds a `dd-sockets` volume to the task, mounts it at `/var/run/datadog` on both the Agent and your application containers, and points the tracers at it with `DD_TRACE_AGENT_URL` and `DD_DOGSTATSD_URL`. Pass `--no-agent-socket` to use the task's loopback address instead, which sets `DD_AGENT_HOST` to `127.0.0.1` and leaves the volume off.

Unlike the switches above, the command owns these: the two ways of reaching the Agent are mutually exclusive, so moving between them removes the one that no longer applies rather than leaving a socket path behind that nothing is listening on.

The Agent sidecar accepts custom metrics over DogStatsD: `DD_DOGSTATSD_ORIGIN_DETECTION` and `DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT` are turned on and `DD_DOGSTATSD_TAG_CARDINALITY` is set to `orchestrator`, so your metrics are tagged with the task that submitted them. These are filled in the same way, so a task definition that already sets them keeps its own values.

Running the command twice is safe: the sidecars are matched by name, so an already instrumented task definition is reported as such and no revision is registered. Each revision the command registers is tagged `dd_sls_ci` with the version of `datadog-ci` that created it. Upgrading the CLI does not on its own produce a new revision, since that tag is not part of the comparison.

#### Collecting logs

Pass `--log-collection` to send the task's logs to Datadog. A `datadog-log-router` sidecar running [AWS for Fluent Bit](https://github.com/aws/aws-for-fluent-bit) is added and the other containers, including the Agent, are routed through it.
Existing log configurations are replaced. Omitting `--log-collection` on a later run does not restore them or remove the router.

#### Deploying the new revision

Pass `--ecs-service` for each service that should run the revision the command just registered, and `--cluster` if those services are not in the `default` cluster. A service named by its full ARN already says which cluster it runs in, so `--cluster` can be left off; passing a `--cluster` that contradicts the ARN's cluster is an error, not a silent override. A run updates services in a single cluster, so ARNs naming more than one are reported too. Each service is matched to the task definition family it currently runs, so a run over several task definitions points each service at its own new revision, and a service already running the instrumented revision is left alone rather than redeployed. The matching happens before anything is registered, so a service running a family that no `--task-definition` covers is reported without a revision having been registered for it. Updating a service starts an ECS deployment: the command returns as soon as ECS accepts it, and the rollout follows your service's deployment configuration.

Because a service is matched by family, a run instruments one revision per family: naming two revisions of the same family, as `--task-definition my-app:3 --task-definition my-app:4` does, is reported rather than leaving the choice of which one to deploy to the order they were passed in.

A task definition and the services running it are instrumented and deployed on their own, so a run over several of them reports every problem it hits and still rolls out the ones that worked: a task definition that could not be instrumented leaves its own services alone, and the rest reach their new revision. Tasks you start yourself with `RunTask`, and services you do not name, keep running the revision they were on.

### Configuration

#### AWS credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html#envvars-list) configured with access to the ECS actions `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, and `ecs:TagResource`. The last one is required because the new revision is registered with tags: the ones the task definition already had, plus `service`, `env`, `version`, and `dd_sls_ci`. Deploying with `--ecs-service` also needs `ecs:DescribeServices` and `ecs:UpdateService`.

`--profile` uses a named profile from your AWS configuration instead. A profile with an `mfa_serial` is supported: the command asks for the code when it loads the profile.

#### Datadog API key

Pass `--api-key-secret-arn` with the ARN of an AWS Secrets Manager secret holding your [Datadog API key](https://app.datadoghq.com/organization-settings/api-keys). The Agent reads the key from the secret at runtime, which keeps it out of the task definition. The task's execution role needs `secretsmanager:GetSecretValue` on that secret. ECS resolves secrets through that role, so a task definition with no `executionRoleArn` is reported and left alone rather than turned into a revision whose tasks cannot start.

If you do not pass `--api-key-secret-arn`, the command falls back to the `DD_API_KEY` environment variable and writes its value into the task definition in plain text, which it warns about. A key given this way is validated against your Datadog site before anything is registered, and is masked in the diff the command prints.

#### Task role

The Agent collects ECS task metadata, which is what tags your telemetry with the task, container, and image it came from. It reads that from the ECS API as the task role, so give the task definition a `taskRoleArn` whose policy allows `ecs:ListClusters`, `ecs:ListContainerInstances`, and `ecs:DescribeContainerInstances`. The command does not change your task role, so it reports a task definition that has none.

#### Environment variables

- `DD_BETA_COMMANDS_ENABLED`: set to `1` to enable this command while it is in beta.
- `DD_API_KEY` (or `DATADOG_API_KEY`): the Datadog API key to write into the task definition, used only when `--api-key-secret-arn` is not passed.
- `DD_SITE` (or `DATADOG_SITE`): the [Datadog site](https://docs.datadoghq.com/getting_started/site/) to send data to. Defaults to `datadoghq.com`.
- `AWS_REGION` (or `AWS_DEFAULT_REGION`): the region to use when `--region` is not passed.

### Arguments

You can pass the following arguments to `instrument` to specify its behavior. `--fips` and `--fips-ignore-error` are also accepted, as they are on every command.

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Preview the changes the command would apply | `false` |
| `--task-definition` or `--taskDefinition` |  | The family, family:revision, or ARN of the task definition to instrument. Can be specified multiple times. |  |
| `--region` | `-r` | The AWS region the task definition lives in |  |
| `--profile` |  | Specify the AWS named profile credentials to use to instrument. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles |  |
| `--ecs-service` or `--ecsService` |  | The name of an ECS service to update to the newly instrumented revision, so that the change rolls out without a manual deployment. Can be specified multiple times. |  |
| `--cluster` |  | The ECS cluster the services named by `--ecs-service` run in. Not needed when those are full ARNs, which name their own cluster. Omit it for the `default` cluster of the region. |  |
| `--api-key-secret-arn` or `--apiKeySecretArn` |  | The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over DD_API_KEY, which is written to the task definition in plain text |  |
| `--agent-image` or `--sidecar-image` |  | Override to pin a specific version tag or to use a mirrored image from a custom registry (for example, ECR) to avoid pull rate limits. | `public.ecr.aws/datadog/agent:latest` |
| `--no-agent-socket` |  | Have the tracers reach the Agent over the task loopback address instead of the Unix socket they use by default. |  |
| `--log-collection` or `--logCollection` |  | Send the task's logs to Datadog. Replaces each container's existing log configuration. |  |
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
    "ecsServices": ["my-app-service", "my-worker-service"],
    "cluster": "my-cluster",
    "apiKeySecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:dd-api-key",
    "service": "my-service",
    "environment": "prod",
    "version": "1.0.0",
    "extraTags": "team:backend,project:api",
    "envVars": ["CUSTOM_VAR1=value1", "CUSTOM_VAR2=value2"],
    "logCollection": true
  }
}
```

Keys name the setting rather than the argument, so a flag that turns something off is the setting set to `false`: `--no-agent-socket` is `"agentSocket": false`.

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).
