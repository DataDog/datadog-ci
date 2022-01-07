You can use the CLI to instrument your AWS Lambda functions with Datadog. The CLI enables instrumentation by modifying existing Lambda functions' configuration and hence does *not* require redeployment. It is the quickest way to get started with Datadog serverless monitoring.

You can also add the command to your CI/CD pipelines to enable instrumentation for *all* your serverless applications. Run the command *after* your normal serverless application deployment, so that changes made by the Datadog CLI command do not get overridden.

Only Lambda functions using the Python or Node.js runtime are currently supported.

## Installation

Follow the installation instructions for [Python](https://docs.datadoghq.com/serverless/installation/python/?tab=datadogcli) or [Node.js](https://docs.datadoghq.com/serverless/installation/nodejs/?tab=datadogcli) to instrument your Lambda functions using the `datadog-ci lambda instrument` command.

## Commands

### `instrument`

Run `datadog-ci lambda instrument` to apply Datadog instrumentation to a Lambda. This command automatically adds the Datadog Lambda Library and/or the Datadog Lambda Extension as Lambda Layers to the instrumented Lambda functions and modifies their configurations. 

```bash
# Instrument multiple functions specified by names
datadog-ci lambda instrument -f <function-name> -f <another-function-name> -r us-east-1 -v 46 -e 10

# Instrument multiple functions that match a regex pattern
datadog-ci lambda instrument --functions-regex <valid-regex-pattern> -r us-east-1 -v 46 -e 10

# Dry run of all updates
datadog-ci lambda instrument -f <function-name> -f <another-function-name> -r us-east-1 -v 46 -e 10 --dry
```

### `uninstrument`

Run `datadog-ci lambda uninstrument` to revert Datadog instrumentation in a Lambda. This command automatically removes the Datadog configuration, such as the Datadog Lambda Library and the Datadog Lambda Extension layers, as well as other configurations applied by the datadog-ci.

```bash
# Uninstrument multiple functions specified by names
datadog-ci lambda uninstrument -f <function-name> -f <another-function-name> -r us-east-1 

# Instrument multiple functions that match a regex pattern
datadog-ci lambda uninstrument --functions-regex <valid-regex-pattern> -r us-east-1

# Dry run of all updates
datadog-ci lambda uninstrument -f <function-name> -f <another-function-name> -r us-east-1 --dry
```

See the configuration section for additional settings.

## Configuration

### AWS Credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html) configured with access to the Lambda and CloudWatch services where you are running any `datadog-ci lambda` command.

### Environment variables

You must expose these environment variables in the environment where you are running `datadog-ci lambda instrument`:

| Environment Variable | Description | Example |
| --- | --- | --- |
| `DATADOG_API_KEY` | Datadog API Key. Sets the `DD_API_KEY` environment variable on your Lambda function configuration. For more information about getting a Datadog API key, see the [API key documentation][6].  | `export DATADOG_API_KEY=<API_KEY>` |
| `DATADOG_API_KEY_SECRET_ARN` | The ARN of the secret storing the Datadog API key in AWS Secrets Manager. Sets the `DD_API_KEY_SECRET_ARN` on your Lambda function configuration. Notes: `DD_API_KEY_SECRET_ARN` is ignored when `DD_KMS_API_KEY` is set. Add the `secretsmanager:GetSecretValue` permission to the Lambda execution role. | `export DATADOG_API_KEY_SECRET_ARN=<SECRETS_MANAGER_RESOURCE_ARN>` |
| `DATADOG_KMS_API_KEY` | Datadog API Key encrypted using KMS. Sets the `DD_KMS_API_KEY` environment variable on your Lambda function configuration. Note: `DD_API_KEY` is ignored when `DD_KMS_API_KEY` is set. | `export DATADOG_KMS_API_KEY=<KMS_ENCRYPTED_API_KEY>` |
| `DATADOG_SITE` | Set which Datadog site to send data. Only needed when using the Datadog Lambda Extension. Possible values are  `datadoghq.com` , `datadoghq.eu` , `us3.datadoghq.com`, `us5.datadoghq.com`, and `ddog-gov.com`. The default is `datadoghq.com`. Sets the `DD_SITE` environment variable on your Lambda function configurations. | `export DATADOG_SITE="datadoghq.com"` |


### Arguments

Configuration can be done using command-line arguments or a JSON configuration file (see the next section).

#### `instrument`
You can pass the following arguments to `instrument` to specify its behavior. These arguments will override the values set in the configuration file, if any.

| Argument | Shorthand | Description | Default |
| --- | --- | --- | --- |
| `--function` | `-f` | The ARN of the Lambda function to be **instrumented**, or the name of the Lambda function (`--region` must be defined). | |
| `--functions-regex` | | A regex pattern to match with the Lambda function name. | |
| `--region` | `-r` | Default region to use, when `--function` is specified by the function name instead of the ARN. | |
| `--service` | | Use `--service` to group related functions belonging to similar workloads. Learn more about the `service` tag [here][9]. | |
| `--version` | | Add the `--version` tag to correlate spikes in latency, load or errors to new versions. Learn more about the `version` tag [here][8]. | |
| `--env` | | Use `--env` to separate out your staging, development, and production environments. Learn more about the `env` tag [here][7]. | |
| `--extra-tags` | | Add custom tags to your Lambda function in Datadog. Must be a list of `<key>:<value>` separated by commas such as: `layer:api,team:intake`. | |
| `--layer-version` | `-v` | Version of the Datadog Lambda Library layer to apply. This varies between runtimes. To see the latest layer version check the [JS][3] or [python][4] datadog-lambda-layer repo release notes. | |
| `--extension-version` | `-e` | Version of the Datadog Lambda Extension layer to apply. When `extension-version` is set, make sure to export `DATADOG_API_KEY` (or if encrypted, `DATADOG_KMS_API_KEY` or `DATADOG_API_KEY_SECRET_ARN`) in your environment as well. While using `extension-version`, leave out `forwarder`. Learn more about the Lambda Extension [here][5]. | |
| `--tracing` |  | Whether to enable dd-trace tracing on your Lambda. | `true` |
| `--merge-xray-traces` | | Whether to join dd-trace traces to AWS X-Ray traces. Useful for tracing API Gateway spans. | `false` |
| `--flush-metrics-to-logs` | | Whether to send metrics via the Datadog Forwarder [asynchronously][11]. If you disable this parameter, it's required to export `DATADOG_API_KEY` (or if encrypted, `DATADOG_KMS_API_KEY` or `DATADOG_API_KEY_SECRET_ARN`). | `true` |
| `--forwarder` | | The ARN of the [datadog forwarder][10] to attach this function's LogGroup to. | |
| `--dry` | `-d` | Preview changes running command would apply. | `false` |
| `--log-level` | | Set to `debug` to see additional output from the Datadog Lambda Library and/or Lambda Extension for troubleshooting purposes. | |
| `--source-code-integration` | `-s` | Whether to enable Datadog Source Code Integration. This will send Datadog the Git metadata in the current local directory and tag your lambda(s) with the latest commit. Provide `DATADOG_API_KEY` if using this feature. **Note**: Git repository must not be ahead of remote, and must not be dirty. | `false` |

<br />

#### `uninstrument`
The following arguments are passed to `uninstrument` to specify its behavior. These arguments will override the values set in the configuration file, if any.

Any other argument stated on the `instrument` table, but not below, will be ignored, this to allow you to uninstrument quicker, if needed.

| Argument | Shorthand | Description | Default |
| --- | --- | --- | --- |
| `--function` | `-f` | The ARN of the Lambda function to be **uninstrumented**, or the name of the Lambda function (`--region` must be defined). | |
| `--functions-regex` | | A regex pattern to match with the Lambda function name to be **uninstrumented**. | |
| `--region` | `-r` | Default region to use, when `--function` is specified by the function name instead of the ARN. | |
| `--forwarder` | | The ARN of the [datadog forwarder][10] to remove from this function. | |
| `--dry` | `-d` | Preview changes running command would apply. | `false` |

<br/>

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and simply run the `datadog-ci lambda {instrument|uninstrument} --config datadog-ci.json` command on each deployment. Specify the `datadog-ci.json` using the `--config` argument, and use this configuration file structure:

```json
{
    "lambda": {
        "layerVersion": 10,
        "extensionVersion": 8,
        "functions": ["arn:aws:lambda:us-east-1:000000000000:function:autoinstrument"],
        "region": "us-east-1",
        "tracing": true,
        "mergeXrayTraces": true,
        "forwarder": "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder",
        "logLevel": "debug",
        "service":"some-service",
        "version":"b17s47h3w1n",
        "environment":"staging",
        "extraTags":"layer:api,team:intake"
    }
}
```
## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
[2]: https://github.com/DataDog/datadog-ci
[3]: https://github.com/DataDog/datadog-lambda-layer-js/releases
[4]: https://github.com/DataDog/datadog-lambda-layer-python/releases
[5]: https://docs.datadoghq.com/serverless/datadog_lambda_library/extension
[6]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
[7]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-env-tag
[8]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-version-tag
[9]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-service-tag
[10]: https://docs.datadoghq.com/serverless/forwarder/
[11]: https://docs.datadoghq.com/serverless/custom_metrics?tab=python#enabling-asynchronous-custom-metrics
