You can use the CLI to instrument your AWS Lambda functions with Datadog. The CLI enables instrumentation by modifying existing Lambda functions' configuration and hence does *not* require redeployment. It is the quickest way to get started with Datadog serverless monitoring.

You can also add the command to your CI/CD pipelines to enable instrumentation for *all* your serverless applications. Run the command *after* your normal serverless application deployment, so that changes made by the Datadog CLI command do not get overridden.

Only Lambda functions using the Python or Node.js runtime are currently supported.

## Installation

Follow the installation instructions for [Python](https://docs.datadoghq.com/serverless/installation/python/?tab=datadogcli) or [Node.js](https://docs.datadoghq.com/serverless/installation/nodejs/?tab=datadogcli) to instrument your Lambda functions using the `datadog-ci lambda instrument` command.

## Commands

Run `datadog-ci lambda instrument` to apply Datadog instrumentation to a Lambda. This command automatically adds the Datadog Lambda Library and/or the Datadog Lambda Extension as Lambda Layers to the instrumented Lambda functions and modifies their configurations. 

```bash
# Instrument multiple functions specified by names
datadog-ci lambda instrument -f functionname -f another-functionname -r us-east-1 -v 46 -e 10

# Instrument multiple functions that match a regex pattern
datadog-ci lambda instrument --functions-regex validregexpattern -r us-east-1 -v 46 -e 10

# Dry run of all updates
datadog-ci lambda instrument -f functionname -f another-functionname -r us-east-1 -v 46 -e 10 --dry
```

See the configuration section for additional settings.

## Configuration

### AWS Credentials

You must have valid [AWS credentials](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html) configured with access to the Lambda and CloudWatch services where you are running `datadog-ci lambda instrument`.

### Environment variables

You must expose these environment variables in the environment where you are running `datadog-ci lambda instrument`:

| Environment Variable | Description | Example |
| --- | --- | --- |
| DATADOG_API_KEY | Datadog API Key. Sets the `DD_API_KEY` environment variable on your Lambda function configuration. For more information about getting a Datadog API key, see the [API key documentation][6].  | export DATADOG_API_KEY="1234" |
| DATADOG_KMS_API_KEY | Datadog API Key encrypted using KMS. Sets the `DD_KMS_API_KEY` environment variable on your Lambda function configuration. Note: `DD_API_KEY` is ignored when `DD_KMS_API_KEY` is set. | export DATADOG_KMS_API_KEY="5678" |
| DATADOG_SITE | Set which Datadog site to send data. Only needed when using the Datadog Lambda Extension. Possible values are  `datadoghq.com` , `datadoghq.eu` , `us3.datadoghq.com` and `ddog-gov.com`. The default is `datadoghq.com`. Sets the `DD_SITE` environment variable on your Lambda function configurations. | export DATADOG_SITE="datadoghq.com" |


### Arguments

Configuration can be done using command-line arguments or a JSON configuration file (see the next section).

You can pass the following arguments to `instrument` to specify its behavior. These arguments will override the values set in the configuration file, if any.

| Argument | Shorthand | Description | Default |
| --- | --- | --- | --- |
| --function | -f | The ARN of the Lambda function to be instrumented, or the name of the Lambda function (--region must be defined) | |
| --functions-regex | | A regex pattern to match with the Lambda function name | |
| --region | -r | Default region to use, when `--function` is specified by the function name instead of the ARN | |
| --layerVersion | -v | Version of the Datadog Lambda Library layer to apply. This varies between runtimes. To see the latest layer version check the [JS][3] or [python][4] datadog-lambda-layer repo release notes | |
| --extensionVersion | -e | Version of the Datadog Lambda Extension layer to apply. When `extensionVersion` is set, make sure to export `DATADOG_API_KEY` (or `DATADOG_KMS_API_KEY`) in your environment as well. While using `extensionVersion`, leave out `forwarder` Learn more about the Lambda Extension [here][5]| |
| --tracing |  | Whether to enable dd-trace tracing on your Lambda | true |
| --mergeXrayTraces | | Whether to join dd-trace traces to AWS X-Ray traces. Useful for tracing API Gateway spans. | false |
| --flushMetricsToLogs | | Whether to send metrics via the Datadog Forwarder [asynchronously](https://docs.datadoghq.com/serverless/custom_metrics?tab=python#enabling-asynchronous-custom-metrics) | true |
| --forwarder | | The ARN of the [datadog forwarder](https://docs.datadoghq.com/serverless/forwarder/) to attach this function's LogGroup to. | |
| --dry | -d | Preview changes running command would apply. | false |
| --logLevel | | Set to `debug` to see additional output from the Datadog Lambda Library and/or Lambda Extension for troubleshooting purposes. | |

<br />


### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and simply run the `datadog-ci lambda instrument --config datadog-ci.json` command on each deployment. Specify the `datadog-ci.json` using the `--config` argument, and use this configuration file structure:

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
        "logLevel": "debug"
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
