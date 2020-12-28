<div class="alert alert-warning">
This feature is in open beta. Let us know of any questions or issues by filing an <a href="https://github.com/DataDog/datadog-ci/issues">issue</a> in our repo.
</div>

You can use the CLI to instrument your AWS Lambda functions with Datadog. Only Python and Node.js runtimes are currently supported.

### Before you begin

Make your AWS credentials `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` available in your environment using the following cmd, or use any of the authentication methods supported by the [AWS JS sdk][1].

```bash
# Environment setup
export AWS_ACCESS_KEY_ID="<ACCESS KEY ID>"
export AWS_SECRET_ACCESS_KEY="<ACCESS KEY>"
```

Download the [Datadog CI][2].

### Configuration

Configuration is done using a JSON file. Specify the `datadog-ci.json` using the `--config` argument, and this configuration file structure:

```json
{
    "lambda": {
        "layerVersion": 10,
        "functions": ["arn:aws:lambda:us-east-1:000000000000:function:autoinstrument"],
        "region": "us-east-1",
        "tracing": true,
        "mergeXrayTraces": true,
        "forwarder": "arn:aws:lambda:us-east-1:000000000000:function:datadog-forwarder"
    }
}
```

#### Commands

Use `instrument` to apply Datadog instrumentation to a Lambda. This command automatically adds the Datadog Lambda library as layers to the instrumented Lambda functions and modifies their configurations. 

This command is the quickest way to try out Datadog instrumentation on an existing Lambda function. To use in the production environment, run this command in your CI/CD pipelines to ensure your Lambda functions are always updated for instrumentation.

```bash
# instrument a function specified by ARN
datadog-ci lambda instrument --function arn:aws:lambda:us-east-1:000000000000:function:functionname --layerVersion 10

# Use the shorthand formats
datadog-ci lambda instrument -f arn:aws:lambda:us-east-1:000000000000:function:functionname -v 10

# Instrument multiple functions specified by their names (--region must be defined)
datadog-ci lambda instrument -f functionname -f another-functionname -r us-east-1 -v 10

# Dry run of all update commands
datadog-ci lambda instrument -f functionname -r us-east-1 -v 10 --dry
```

All arguments:

| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| --function | -f | The ARN of the Lambda function to be instrumented, or the name of the Lambda function (--region must be defined) | |
| --region | -r | Default region to use, when `--function` is specified by the function name instead of the ARN | |
| --layerVersion | -v | Version of the Datadog layer to apply. This varies between runtimes. To see the latest layer version check the [JS][3] or [python][4] datadog-lambda-layer repo release notes. | |
| --tracing |  | Whether to enable dd-trace tracing on your Lambda. | true |
| --mergeXrayTraces | | Whether to join dd-trace traces to AWS X-Ray traces. Useful for tracing API Gateway spans. | false |
| --flushMetricsToLogs | | Whether to send metrics via the Datadog Forwarder [asynchronously](https://docs.datadoghq.com/serverless/custom_metrics?tab=python#enabling-asynchronous-custom-metrics) | true |
| --forwarder | | The ARN of the [datadog forwarder](https://docs.datadoghq.com/serverless/forwarder/) to attach this functions LogGroup to. | |
| --dry | -d | Preview changes running command would apply. | false |

[1]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
[2]: https://github.com/DataDog/datadog-ci
[3]: https://github.com/DataDog/datadog-lambda-layer-js/releases
[4]: https://github.com/DataDog/datadog-lambda-layer-python/releases
