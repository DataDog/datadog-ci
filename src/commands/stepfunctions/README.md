# stepfunctions commands

The Step Functions commands allow you to manage Datadog instrumentation and troubleshooting for your AWS Step Functions:

- Use the `stepfunctions instrument` command to instrument your Step Functions with Datadog. This command enables instrumentation by subscribing Step Function logs to a [Datadog Forwarder](https://docs.datadoghq.com/logs/guide/forwarder/).
- Use the `stepfunctions uninstrument` command to remove Datadog instrumentation from your Step Functions.
- Use the `stepfunctions flare` command to collect diagnostic information for troubleshooting with Datadog support.

You can also add the `stepfunctions instrument` command to your CI/CD pipelines to enable Datadog instrumentation for all of your Step Functions. Run the command after your normal serverless application deployment, so that changes made by this command do not get overridden by changes in the CI/CD pipeline.

## Usage

### `instrument`

Run the `instrument` command to subscribe a Step Function log group to the specified Datadog Forwarder. In the Step Function logging configuration, if either `logLevel: ALL` or `includeExecutionData: true` is not set, then the Step Function logging configuration will be updated to use those settings.

If logging is not enabled on a Step Function, a log group will be created and the Step Function will be updated to log to it with `logLevel: ALL` and `includeExecutionData: true`. Note that the Step Function needs permission to log to CloudWatch logs. See [Step Function Logging using CloudWatch Logs](https://docs.aws.amazon.com/step-functions/latest/dg/cw-logs.html) for the specific permissions needed.

```bash
datadog-ci stepfunctions instrument --step-function <step-function-arn> --forwarder <forwarder-arn> [--service] [--env] [--dry-run]
```

### `uninstrument`
Run the `uninstrument` command to unsubscribe a Step Function log group from the specified Datadog Forwarder. The log group will not be deleted and the Step Function will continue to log to the AWS log group.

```bash
datadog-ci stepfunctions uninstrument --step-function <step-function-arn> --forwarder <forwarder-arn> [--dry-run]
```

### `flare`
Run the `flare` command to gather state machine configuration, execution history, logs, and project files for Datadog support troubleshooting. This command collects diagnostic information about your Step Functions and creates a flare file that can be shared with Datadog support.

```bash
datadog-ci stepfunctions flare --state-machine <state-machine-arn> --case-id <case-id> --email <email> [--region] [--with-logs] [--start] [--end] [--max-executions] [--dry-run]
```

## Arguments

### instrument

| Argument          | Shorthand | Description                                                                                                                                                                                                                                               | Default |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `--step-function` | `-s`           | The ARN of the Step Function to be instrumented. Repeat `--step-function` to instrument multiple Step Functions.                                                                                                                                          |         |
| `--forwarder`     |                | The ARN of the [Datadog Forwarder](https://docs.datadoghq.com/logs/guide/forwarder/) to subscribe Step Function log groups.                                                                                                                               |         |
| `--env`           | `-e`           | Separate your staging, development, and production environments by `env`. Learn more about [Serverless Tagging](https://docs.datadoghq.com/serverless/guide/serverless_tagging/#the-env-tag). ** **Optional if env tag is already set on Step Functions** |         |
| `--service`       |                | Group Step Functions belonging to similar workloads by `service`. Learn more about [Serverless Tagging](https://docs.datadoghq.com/serverless/guide/serverless_tagging/#the-service-tag).                                                                 |         |
| `--dry-run`       | `-d`           | Preview changes without applying them.                                                                                                                                                                                                                    | `false` |
| `--propagate-upstream-trace`       |             | Update Step Function definitions to inject context into invocations to other Step Functions or Lambda functions.                                                                                                                            | `false` |

### uninstrument

| Argument          | Shorthand | Required           | Description                                                                                                                 | Default |
| ----------------- | --------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------- |
| `--step-function` | `-s`      | :white_check_mark: | The ARN of the Step Function to be instrumented.                                                                            |         |
| `--forwarder`     |           | :white_check_mark: | The ARN of the [Datadog Forwarder](https://docs.datadoghq.com/logs/guide/forwarder/) to subscribe Step Function log groups. |         |
| `--dry-run`       | `-d`      |                    | Preview changes without applying them.                                                                                      | `false` |

### flare

| Argument          | Shorthand | Required           | Description                                                                                                                                                                                     | Default |
| ----------------- | --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `--state-machine` | `-s`      | :white_check_mark: | The ARN of the Step Functions state machine to collect diagnostic information from.                                                                                                             |         |
| `--case-id`       | `-c`      | :white_check_mark: | The Datadog support case ID to associate with this flare.                                                                                                                                      |         |
| `--email`         | `-e`      | :white_check_mark: | The email address associated with the support case.                                                                                                                                             |         |
| `--with-logs`     |           |                    | Include CloudWatch logs from the state machine's log group in the flare.                                                                                                                       | `false` |
| `--start`         |           |                    | Start time for log collection (ISO 8601 format). Only used with `--with-logs`.                                                                                                                 |         |
| `--end`           |           |                    | End time for log collection (ISO 8601 format). Only used with `--with-logs`.                                                                                                                   |         |
| `--max-executions`|           |                    | Maximum number of recent executions to include in the flare.                                                                                                                                   | `10`    |
| `--dry-run`       | `-d`      |                    | Preview the flare collection without creating or sending files.                                                                                                                                 | `false` |

## Installation

1. Install the Datadog CLI

See [How to install the CLI](https://github.com/DataDog/datadog-ci/tree/duncan-harvey/add-step-function-command#how-to-install-the-cli) for instructions to install the Datadog CLI.

2. Configure your AWS Credentials

Datadog CLI depends on the AWS JavaScript SDK to [resolve AWS credentials](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html). Ensure your AWS credentials are configured using the same method you would use when invoking the AWS CLI.

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
[2]: https://github.com/DataDog/datadog-ci
[3]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-env-tag
[4]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-service-tag
[5]: https://docs.datadoghq.com/serverless/forwarder/
[6]: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles
[7]: https://docs.datadoghq.com/serverless/libraries_integrations/cli/

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Installing Serverless Monitoring for AWS Step Functions][8]

[8]: https://docs.datadoghq.com/serverless/step_functions/installation/?tab=datadogcli
