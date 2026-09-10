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

Application containers are given `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, and `DD_TAGS` from the arguments above, so the traces, logs, and metrics your tracers send are tagged consistently. `DD_SERVICE` is `--service`, or the task definition family when `--service` is omitted, and is written to the application containers, the Agent, the Docker labels, and the revision tags so they cannot disagree. `DD_TRACE_ENABLED` and `DD_LOGS_INJECTION` are only filled in when the container does not set them itself, so a task definition that has already made a choice keeps it. Everything else the command is asked for wins over what the task definition had.

Product settings the command owns are applied when those flags are on and removed when they are not: `--no-appsec` drops `DD_APPSEC_ENABLED`, omitting `--llmobs` drops the LLM Observability variables, and `--no-source-code-integration` drops the Git tags from `DD_TAGS`.

The same three unified service tag values are also written to the application containers as the `com.datadoghq.tags.service`, `com.datadoghq.tags.env`, and `com.datadoghq.tags.version` Docker labels. The environment variables tag what a tracer running inside a container sends; these labels are what the Agent reads to tag the metrics it collects about the container from the outside, so the two line up in Datadog. The Agent container is deliberately left unlabelled, so that it reports its own resource usage under its own name rather than your service's. Labels that are not Datadog's are left alone.

#### Reaching the Agent

The tracers reach the Agent over a Unix socket by default. The command adds a `dd-sockets` volume to the task, mounts it at `/var/run/datadog` on both the Agent and your application containers, and points the tracers at it with `DD_TRACE_AGENT_URL` and `DD_DOGSTATSD_URL`. Pass `--no-agent-socket` to use the task's loopback address instead, which sets `DD_AGENT_HOST` to `127.0.0.1` and leaves the volume off. [Windows tasks](#windows-tasks) always use the loopback address.

Unlike the switches above, the command owns these: the two ways of reaching the Agent are mutually exclusive, so moving between them removes the one that no longer applies rather than leaving a socket path behind that nothing is listening on.

The Agent sidecar accepts custom metrics over DogStatsD: `DD_DOGSTATSD_ORIGIN_DETECTION` and `DD_DOGSTATSD_ORIGIN_DETECTION_CLIENT` are turned on and `DD_DOGSTATSD_TAG_CARDINALITY` is set to `orchestrator`, so your metrics are tagged with the task that submitted them. These are filled in the same way, so a task definition that already sets them keeps its own values.

Running the command twice is safe: the sidecars are matched by name, so an already instrumented task definition is reported as such and no revision is registered. Each revision the command registers is tagged `dd_sls_ci` with the version of `datadog-ci` that created it. Upgrading the CLI does not on its own produce a new revision, since that tag is not part of the comparison.

#### Collecting logs

Pass `--log-collection` to send the task's logs to Datadog. A `datadog-log-router` sidecar running [AWS for Fluent Bit](https://github.com/aws/aws-for-fluent-bit) is added and the other containers, including the Agent, are routed through it.
Existing log configurations are replaced. Omitting `--log-collection` on a later run removes the router and the Datadog FireLens configuration it wrote, but does not restore the log configuration it replaced. Windows tasks cannot use this as FireLens is Linux-only.

#### Windows tasks

Windows task definitions are instrumented with the following differences:

- The Agent runs the `-servercore` build of the image, published as a manifest list so that ECS pulls the variant matching your Windows Server version.
- The Agent container is given `C:\` as its working directory, which it needs and its image does not set.
- The tracers reach the Agent on the task's loopback address, `127.0.0.1`, because Windows containers cannot share the Unix socket used on Linux. The `dd-sockets` volume is left off, and `--no-agent-socket` makes no difference on a Windows task.
- The Agent gets no health check, as its probe is a shell script that only the Linux image ships. A probe would report the Agent as permanently unhealthy
- `--log-collection` is refused, because FireLens does not run on Windows Fargate. Any `datadog-log-router` sidecar on the task is removed.

A run warns when it drops the socket, when it leaves the Agent without a health check, and when it changes what one of your containers waits for, so you can see what it decided.

If you pass `--agent-image` for a Windows task, it is used exactly as given, so point it at a `-servercore` tag: mirroring `public.ecr.aws/datadog/agent:latest` into your own registry gives you the Linux image, which will not start on Windows.

#### Deploying the new revision

Pass `--ecs-service` for each service that should run the revision the command just registered, and `--cluster` if those services are not in the `default` cluster. A service named by its full ARN already says which cluster it runs in, so `--cluster` can be left off; passing a `--cluster` that contradicts the ARN's cluster is an error, not a silent override. A run updates services in a single cluster, so ARNs naming more than one are reported too. Each service is matched to the task definition family it currently runs, so a run over several task definitions points each service at its own new revision, and a service already running the instrumented revision is left alone rather than redeployed. The matching happens before anything is registered, so a service running a family that no `--task-definition` covers is reported without a revision having been registered for it. Updating a service starts an ECS deployment: the command returns as soon as ECS accepts it, and the rollout follows your service's deployment configuration.

Because a service is matched by family, a run instruments one revision per family: naming two revisions of the same family, as `--task-definition my-app:3 --task-definition my-app:4` does, is reported rather than leaving the choice of which one to deploy to the order they were passed in.

A task definition and the services running it are instrumented and deployed on their own, so a run over several of them reports every problem it hits and still rolls out the ones that worked: a task definition that could not be instrumented leaves its own services alone, and the rest reach their new revision. Tasks you start yourself with `RunTask`, and services you do not name, keep running the revision they were on.

### `uninstrument`

**Warning:** The `ecs-fargate uninstrument` command is in beta. It requires you to set `DD_BETA_COMMANDS_ENABLED=1`.

Run `datadog-ci ecs-fargate uninstrument` to take Datadog instrumentation back off an ECS Fargate task definition. The command reads the task definitions you name, removes what `instrument` added, and registers the result as a new revision. As with `instrument`, nothing that is running changes until the new revision is deployed, which you can add to the command with `--ecs-service`.

```bash
export DD_BETA_COMMANDS_ENABLED=1

# Revert a task definition
datadog-ci ecs-fargate uninstrument --task-definition my-app -r us-east-1

# Revert several task definitions in one run
datadog-ci ecs-fargate uninstrument --task-definition my-app --task-definition my-worker -r us-east-1

# Revert a task definition and roll the new revision out to the service running it
datadog-ci ecs-fargate uninstrument --task-definition my-app -r us-east-1 \
  --ecs-service my-app-service --cluster my-cluster

# Preview the changes without registering a revision
datadog-ci ecs-fargate uninstrument --task-definition my-app -r us-east-1 --dry-run
```

The command removes the `datadog-agent` and `datadog-log-router` sidecars, the `dd-sockets` volume along with its mounts, every `DD_`-prefixed environment variable and secret from your application containers, the `com.datadoghq.tags.service`, `com.datadoghq.tags.env`, and `com.datadoghq.tags.version` Docker labels, and the `service`, `env`, `version`, and `dd_sls_ci` tags from the revision. Add `--env-vars` for each variable you wish to be removed too.

Running the command twice is safe: a task definition with no Datadog instrumentation to remove is reported as such and no revision is registered.

#### Log configurations

`--log-collection` replaces each container's log configuration with one routing through `datadog-log-router`. The container's previous configuration is recorded nowhere, so it cannot be put back. Removing the router leaves each affected container with no log configuration at all, which the command warns about: add one to the task definition to keep collecting those logs.

### Configuration

#### AWS credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html#envvars-list) configured with access to the ECS actions `ecs:DescribeTaskDefinition`, `ecs:RegisterTaskDefinition`, and `ecs:TagResource`. The last one is required because the new revision is registered with tags: for `instrument`, the ones the task definition already had plus `service`, `env`, `version`, and `dd_sls_ci`; for `uninstrument`, the ones that are left once those four are removed. Deploying with `--ecs-service` also needs `ecs:DescribeServices` and `ecs:UpdateService`.

`--profile` uses a named profile from your AWS configuration instead. A profile with an `mfa_serial` is supported: the command asks for the code when it loads the profile.

#### Datadog API key

Pass `--api-key-secret-arn` with the ARN of an AWS Secrets Manager secret holding your [Datadog API key](https://app.datadoghq.com/organization-settings/api-keys). The Agent reads the key from the secret at runtime, which keeps it out of the task definition. The task's execution role needs `secretsmanager:GetSecretValue` on that secret. ECS resolves secrets through that role, so a task definition with no `executionRoleArn` is reported and left alone rather than turned into a revision whose tasks cannot start.

If you do not pass `--api-key-secret-arn`, the command falls back to the `DD_API_KEY` environment variable and writes its value into the task definition in plain text, which it warns about. A key given this way is validated against your Datadog site before anything is registered, and is masked in the diff the command prints.

#### Task role

The Agent collects ECS task metadata, which is what tags your telemetry with the task, container, and image it came from. It reads that from the ECS API as the task role, so give the task definition a `taskRoleArn` whose policy allows `ecs:ListClusters`, `ecs:ListContainerInstances`, and `ecs:DescribeContainerInstances`. The command does not change your task role, so it reports a task definition that has none.

#### Environment variables

- `DD_BETA_COMMANDS_ENABLED`: set to `1` to enable these commands while they are in beta.
- `DD_API_KEY` (or `DATADOG_API_KEY`): the Datadog API key to write into the task definition, used by `instrument` only when `--api-key-secret-arn` is not passed.
- `DD_SITE` (or `DATADOG_SITE`): the [Datadog site](https://docs.datadoghq.com/getting_started/site/) to send data to. Defaults to `datadoghq.com`.
- `AWS_REGION` (or `AWS_DEFAULT_REGION`): the region to use when `--region` is not passed.

### Arguments

`--fips` and `--fips-ignore-error` are also accepted, as they are on every command.

#### `instrument`

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Preview the changes the command would apply | `false` |
| `--task-definition` or `--taskDefinition` |  | The family, family:revision, or ARN of the task definition. Can be specified multiple times. |  |
| `--region` | `-r` | The AWS region the task definition lives in |  |
| `--profile` |  | Specify the AWS named profile credentials to use. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles |  |
| `--ecs-service` or `--ecsService` |  | The name of an ECS service to update to the newly registered revision, so that the change rolls out without a manual deployment. Can be specified multiple times. |  |
| `--cluster` |  | The ECS cluster the services named by `--ecs-service` run in. Not needed when those are full ARNs, which name their own cluster. Omit it for the `default` cluster of the region. |  |
| `--config` |  | Path to the configuration file. |  |
| `--api-key-secret-arn` or `--apiKeySecretArn` |  | The ARN of the AWS Secrets Manager secret holding your Datadog API key. Preferred over DD_API_KEY, which is written to the task definition in plain text |  |
| `--agent-image` or `--sidecar-image` |  | Override to pin a specific version tag or to use a mirrored image from a custom registry (for example, ECR) to avoid pull rate limits. | `public.ecr.aws/datadog/agent:latest` |
| `--no-agent-socket` |  | Have the tracers reach the Agent over the task loopback address instead of the Unix socket they use by default. Windows tasks always use the loopback address. |  |
| `--log-collection` or `--logCollection` |  | Send the task's logs to Datadog. Replaces each container's existing log configuration. Not supported on Windows. |  |
| `--service` |  | The value for the service tag. Use this to group related tasks belonging to similar workloads. For example, `my-service`. If not provided, the task definition family is used. |  |
| `--env` or `--environment` |  | The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`. |  |
| `--version` |  | The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`. |  |
| `--extra-tags` or `--extraTags` |  | Additional tags to add to the task in the format "key1:value1,key2:value2". |  |
| `--env-vars` | `-e` | Additional environment variables to set on the application containers and the Datadog Agent. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
| `--source-code-integration` or `--sourceCodeIntegration` |  | Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` |  | Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--tracing` |  | Enables tracing of your application if the tracer is installed. Disable tracing by setting `--tracing false`. |  |
| `--log-level` or `--logLevel` |  | Specify your Datadog log level. |  |
| `--appsec` |  | Enable Application Security Monitoring for the instrumented task. | `false` |
| `--llmobs` |  | If specified, enables LLM Observability for the instrumented task with the provided ML application name. |  |
<!-- END_USAGE:instrument -->

#### `uninstrument`

<!-- BEGIN_USAGE:uninstrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Preview the changes the command would apply | `false` |
| `--task-definition` or `--taskDefinition` |  | The family, family:revision, or ARN of the task definition. Can be specified multiple times. |  |
| `--region` | `-r` | The AWS region the task definition lives in |  |
| `--profile` |  | Specify the AWS named profile credentials to use. Learn more about AWS named profiles here: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles |  |
| `--ecs-service` or `--ecsService` |  | The name of an ECS service to update to the newly registered revision, so that the change rolls out without a manual deployment. Can be specified multiple times. |  |
| `--cluster` |  | The ECS cluster the services named by `--ecs-service` run in. Not needed when those are full ARNs, which name their own cluster. Omit it for the `default` cluster of the region. |  |
| `--config` |  | Path to the configuration file. |  |
| `--env-vars` | `-e` | Additional environment variables to remove from every container in the task. The Datadog ones are removed either way. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
<!-- END_USAGE:uninstrument -->

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and run `datadog-ci ecs-fargate instrument --config datadog-ci.json`. A `datadog-ci.json` in the working directory is picked up automatically, without `--config`. Arguments you pass on the command line override the values in the configuration file. Both commands read the same file, and `uninstrument` ignores the keys that only apply to instrumenting.

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
