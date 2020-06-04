# Lambda command

Instrument your AWS Lambda functions with datadog.

## Usage

### Setup

You need to have your aws credentials available `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in your environment or pass them to the CLI.

```bash
# Environment setup
export AWS_ACCESS_KEY_ID="<ACCESS KEY ID>"
export AWS_SECRET_ACCESS_KEY="<ACCESS KEY>"

# Or via passing as CLI argument
datadog-ci lambda <command> --awsAccessKeyId "<ACCESS KEY ID>" --awsSecretAccessKey "<ACCESS KEY>"
# Or use the settings is a config file, defaults to datadog-ci.json
datadog-ci lambda <command> --config "datadog-ci.json"
```

### API

#### Configuration

Configuration is done via a json file, by default the tool load `datadog-ci.json` which can be overriden through the `--config` argument.

The configuration file structure is the following, all fields are optional:

```json
{
    "lambda": {
        "awsAccessKeyId": "ABCEDFG",
        "awsSecretAccessKey": "HIJKLM",
        "layerVersion": 10,
        "functions": ["arn:aws:lambda:us-east-1:000000000000:function:autoinstrument"],
        "region": "us-east-1",
        "tracing": true,
        "mergeXrayTraces": true
    }
}
```

#### Commands

The available command is:

- `instrument`: applies datadog instrumentation to a lambda

It accepts the `--function` (or shorthand `-f`) argument to specify which function to instrument. This should be a function arn.

```bash
datadog-ci lambda instrument --function arn:aws:lambda:us-east-1:000000000000:function:autoinstrument --layerVersion 10
# Can also use shorthand formats
datadog-ci lambda instrument -f autoinstrument -f another-func -r us-east-1 -v 10
# Dry run of all update commands
datadog-ci lambda instrument -f autoinstrument -r us-east-1 -v 10 --dry
```

All arguments:

| Argument | Shorthand | Description |
| -------- | --------- | ----------- |
| --function | -f | Specificy a function to instrument |
| --region | -r | Default region to use, when region isn't specified in function arn |
| --layerVersion | -v | Version of the datadog layer to apply. This varies between runtimes. To see the latest layer version check the [js](https://github.com/DataDog/datadog-lambda-layer-js/releases) or [python](https://github.com/DataDog/datadog-lambda-layer-python/releases) datadog-lambda-layer repo release notes. |
| --tracing |  | Whether to enable dd-trace tracing on your lambda, (defaults to true). |
| --mergeXrayTraces | | Whether to join dd-trace traces to AWS X-Ray traces. Useful for tracing API Gateway spans. (defaults to true). |
| --dry | -d | Preview changes running command would apply. |
