<div class="alert alert-warning">
This feature is in open beta. Let us know of any questions or issues by filing an <a href="https://github.com/DataDog/datadog-ci/issues">issue</a> in our repo.
</div>

You can use the CLI to instrument your AWS Lambda functions with Datadog. Only Python and Node.js runtimes are currently supported.

### Before you begin

Make your AWS credentials `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` available in your environment using the following command, or use any of the authentication methods supported by the [AWS JS SDK][1].

```bash
# Environment setup
export AWS_ACCESS_KEY_ID="<ACCESS KEY ID>"
export AWS_SECRET_ACCESS_KEY="<ACCESS KEY>"
```

Download [Datadog CI][2].

### Configuration
#### Configuration file
Configuration can be done using command-line arguments or a JSON configuration file. If you use a configuration file, specify the `datadog-ci.json` using the `--config` argument, and use this configuration file structure:

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

#### Commands

Use `instrument` to apply Datadog instrumentation to a Lambda. This command automatically adds the Datadog Lambda Library and/or the Datadog Lambda Extension as Lambda Layers to the instrumented Lambda functions and modifies their configurations. 

This command is the quickest way to try out Datadog instrumentation on an existing Lambda function. To use in the production environment, run this command in your CI/CD pipelines to ensure your Lambda functions are always updated for instrumentation.

```bash
# Instrument a function specified by ARN
datadog-ci lambda instrument --function arn:aws:lambda:us-east-1:000000000000:function:functionname --layerVersion 10

# Use the shorthand formats
datadog-ci lambda instrument -f arn:aws:lambda:us-east-1:000000000000:function:functionname -v 10

# Instrument multiple functions specified by names (--region must be defined)
datadog-ci lambda instrument -f functionname -f another-functionname -r us-east-1 -v 10

# Dry run of all update commands
datadog-ci lambda instrument -f functionname -r us-east-1 -v 10 --dry
```

#### All arguments

You can pass arguments to `instrument` to specify its behavior. These arguments will override the values set in the configuration file, if any.

| Argument | Shorthand | Description | Default |
| --- | --- | --- | --- |
| --function | -f | The ARN of the Lambda function to be instrumented, or the name of the Lambda function (--region must be defined) | |
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

#### Additional environment variables

You may configure the `lambda instrument` command with environment variables:
*You must expose these environment variables in the environment where you are running `datadog-ci lambda instrument`*

| Environment Variable | Description | Example |
| --- | --- | --- |
| DATADOG_API_KEY | Datadog API Key. Sets the `DD_API_KEY` environment variable on your Lambda function configuration. For more information about getting a Datadog API key, see the [API key documentation][6] | export DATADOG_API_KEY="1234" |
| DATADOG_KMS_API_KEY | Datadog API Key encrypted using KMS. Sets the `DD_KMS_API_KEY` environment variable on your Lambda function  configuration. | export DATADOG_KMS_API_KEY="5678" |
| DATADOG_SITE | Set which Datadog site to send data. Only needed when using the Datadog Lambda Extension. Possible values are  `datadoghq.com` , `datadoghq.eu` , `us3.datadoghq.com` and `ddog-gov.com`. The default is `datadoghq.com`. Sets the `DD_SITE` environment variable on your Lambda function configurations. | export DATADOG_SITE="datadoghq.com" |

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
[2]: https://github.com/DataDog/datadog-ci
[3]: https://github.com/DataDog/datadog-lambda-layer-js/releases
[4]: https://github.com/DataDog/datadog-lambda-layer-python/releases
[5]: https://docs.datadoghq.com/serverless/datadog_lambda_library/extension
[6]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
