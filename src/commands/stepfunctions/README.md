# stepfunctions commands

You can use the `stepfunctions instrument` command to instrument your Step Functions with Datadog. This command enables instrumentation by subscribing Step Function logs to a [Datadog Forwarder](https://docs.datadoghq.com/logs/guide/forwarder/).

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
