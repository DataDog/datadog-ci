## Azure Container Apps

> **BETA**: This feature is in beta. To use it, you must set the environment variable `DD_BETA_COMMANDS_ENABLED=true`.

You can use the CLI to instrument your Azure Container Apps with Datadog. The CLI enables instrumentation by modifying existing Container App configurations to include the Datadog sidecar to enable tracing, log collection, and custom metrics.

## Commands

### `instrument`

Run `datadog-ci container-app instrument` to apply Datadog instrumentation to an Azure Container App. This command configures your Container App with the necessary environment variables and settings for Datadog monitoring.

```bash
# Instrument a Container App using subscription ID, resource group, and name
datadog-ci container-app instrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group> \
  --name <container-app-name>

# Instrument a Container App using a full resource ID
datadog-ci container-app instrument \
  --resource-id "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.App/containerApps/{containerAppName}"

# Instrument multiple Container Apps using resource IDs
datadog-ci container-app instrument \
  --resource-id <resource-id-1> \
  --resource-id <resource-id-2>

# Instrument with configuration
datadog-ci container-app instrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group> \
  --name <container-app-name> \
  --service my-service \
  --env prod \
  --version 1.0.0

# Dry run to preview changes
datadog-ci container-app instrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group> \
  --name <container-app-name> \
  --dry-run
```

## Configuration

### Azure Credentials

You must have valid Azure credentials configured with access to the Container Apps where you are running any `datadog-ci container-app` command. The CLI uses the Azure SDK's default credential chain, which includes:

- Environment variables
- Managed Identity (when running in Azure)
- Azure CLI credentials (`az login`)
- Visual Studio Code credentials
- Azure PowerShell credentials

For local development, ensure you're authenticated via the Azure CLI:
```bash
az login
```

### Environment variables

You must expose these environment variables in the environment where you are running `datadog-ci container-app instrument`:

| Environment Variable | Description | Example |
| -------------------- | ----------- | ------- |
| `DD_BETA_COMMANDS_ENABLED` | **Required**. Must be set to `true` to enable beta commands. | `export DD_BETA_COMMANDS_ENABLED=true` |
| `DD_API_KEY` | **Required**. Datadog API Key. Sets the `DD_API_KEY` environment variable on your Container App. For more information about getting a Datadog API key, see the [API key documentation][1]. | `export DD_API_KEY=<API_KEY>` |
| `DD_SITE` | Set which Datadog site to send data. Possible values are `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, `ap1.datadoghq.com`, `ap2.datadoghq.com`, and `ddog-gov.com`. The default is `datadoghq.com`. | `export DD_SITE=datadoghq.com` |

### Arguments

Configuration can be done using command-line arguments or a JSON configuration file (see the next section).

#### `instrument`
You can pass the following arguments to `instrument` to specify its behavior. These arguments will override the values set in the configuration file, if any.

| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--subscription-id` | `-s` | Azure Subscription ID containing the Container App. Must be used with `--resource-group` and `--name`. | |
| `--resource-group` | `-g` | Name of the Azure Resource Group containing the Container App. Must be used with `--subscription-id` and `--name`. | |
| `--name` | `-n` | Name of the Azure Container App to instrument. Must be used with `--subscription-id` and `--resource-group`. | |
| `--resource-id` | `-r` | Full Azure resource ID to instrument. Can be specified multiple times. Format: `/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.App/containerApps/{containerAppName}` | |
| `--service` | | The value for the service tag. Use this to group related Container Apps belonging to similar workloads. For example, `my-service` | |
| `--env` or `--environment` | | The value for the env tag. Use this to separate out your staging, development, and production environments. For example, `prod` | |
| `--version` | | The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0` | |
| `--instance-logging` | | When enabled, log collection is automatically configured for an additional file path: `/home/LogFiles/*$COMPUTERNAME*.log` | `false` |
| `--shared-volume-name` | | (Not recommended) Specify a custom shared volume name. | `shared-volume` |
| `--shared-volume-path` | | (Not recommended) Specify a custom shared volume path. | `/shared-volume` |
| `--logs-path` | | (Not recommended) Specify a custom log file path. Must begin with the shared volume path. | `/shared-volume/logs/*.log` |
| `--source-code-integration` or `--sourceCodeIntegration` | | Enable source code integration to add git metadata as tags. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` | | Upload git metadata to Datadog. Only required if you don't have the Datadog GitHub Integration installed. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--extra-tags` or `--extraTags` | | Additional tags to add to the service in the format `key1:value1,key2:value2` | |
| `--env-vars` | `-e` | Additional environment variables to set for the Container App. Can specify multiple in the form `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2` | |
| `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply. | `false` |
| `--config` | | Path to a configuration file. See the configuration file section below. | |
| `--fips` | | Enable FIPS support for the Container App. | `false` |
| `--fips-ignore-error` | | Ignore errors when enabling FIPS support. | `false` |

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and simply run the `datadog-ci container-app instrument --config datadog-ci.json` command. Specify the `datadog-ci.json` using the `--config` argument, and use this configuration file structure:

```json
{
  "containerApp": {
    "subscriptionId": "your-subscription-id",
    "resourceGroup": "your-resource-group",
    "containerAppName": "your-container-app-name",
    "service": "my-service",
    "environment": "prod",
    "version": "1.0.0",
    "logPath": "/home/LogFiles/*.log",
    "isInstanceLoggingEnabled": false,
    "sourceCodeIntegration": true,
    "uploadGitMetadata": true,
    "extraTags": "team:backend,project:api",
    "envVars": [
      "CUSTOM_VAR1=value1",
      "CUSTOM_VAR2=value2"
    ]
  }
}
```

Alternatively, you can use resource IDs:

```json
{
  "containerApp": {
    "resourceIds": [
      "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.App/containerApps/{containerAppName1}",
      "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.App/containerApps/{containerAppName2}"
    ],
    "service": "my-service",
    "environment": "prod"
  }
}
```

## Examples

### Basic instrumentation

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=your-api-key
export DD_SITE=datadoghq.com

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app
```

### Instrumentation with tags and version

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=your-api-key

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app \
  --service my-web-api \
  --env production \
  --version v2.5.0 \
  --extra-tags team:platform,cost-center:engineering
```

### Instrumentation with custom logging

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=your-api-key

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app \
  --log-path /home/LogFiles/myapp/*.log \
  --instance-logging
```


### Dry run to preview changes

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=your-api-key

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app \
  --dry-run
```

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
