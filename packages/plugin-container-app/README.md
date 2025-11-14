## Azure Container Apps

> **BETA**: This feature is in beta. To use it, you must set the environment variable `DD_BETA_COMMANDS_ENABLED=true`.

You can use the CLI to instrument your Azure Container Apps with Datadog. The CLI enables instrumentation by modifying existing Container App configurations to include the Datadog sidecar, which enables tracing, log collection, and custom metrics.

See [the docs](https://docs.datadoghq.com/serverless/azure_container_apps/sidecar/) for language-specific application steps needed in addition to these commands.

## Commands

### `instrument`

Run `datadog-ci container-app instrument` to apply Datadog instrumentation to an Azure Container App. This command configures your Container App with the necessary environment variables and settings for Datadog monitoring.

```bash
# Instrument a Container App using subscription ID, resource group, and name
datadog-ci container-app instrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group-name> \
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
  --resource-group <resource-group-name> \
  --name <container-app-name> \
  --service my-service \
  --env prod \
  --version 1.0.0

# Dry run to preview changes
datadog-ci container-app instrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group-name> \
  --name <container-app-name> \
  --dry-run
```

### `uninstrument`

Run `datadog-ci container-app uninstrument` to remove Datadog instrumentation from an Azure Container App. This command reverts the Container App configuration to its pre-instrumented state by removing the Datadog sidecar and associated environment variables.

```bash
# Uninstrument a Container App using subscription ID, resource group, and name
datadog-ci container-app uninstrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group-name> \
  --name <container-app-name>

# Uninstrument a Container App using a full resource ID
datadog-ci container-app uninstrument \
  --resource-id "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.App/containerApps/{containerAppName}"

# Uninstrument multiple Container Apps using resource IDs
datadog-ci container-app uninstrument \
  --resource-id <resource-id-1> \
  --resource-id <resource-id-2>

# Dry run to preview changes
datadog-ci container-app uninstrument \
  --subscription-id <subscription-id> \
  --resource-group <resource-group-name> \
  --name <container-app-name> \
  --dry-run
```

## Configuration

### Azure Credentials

You must have valid Azure credentials configured with access to the Container Apps where you are running any `datadog-ci container-app` commands. The CLI uses the Azure SDK's default credential chain, which includes:

- Environment variables
- Managed Identity (when running in Azure)
- Azure CLI credentials (`az login`)
- Visual Studio Code credentials
- Azure PowerShell credentials

For local development, ensure you're authenticated through the Azure CLI:
```bash
az login
```

### Environment variables

You must expose these environment variables in the environment where you are running `datadog-ci container-app instrument`:

| Environment Variable | Description | Example |
| -------------------- | ----------- | ------- |
| `DD_BETA_COMMANDS_ENABLED` | **Required**. Must be set to `true` to enable beta commands. | `export DD_BETA_COMMANDS_ENABLED=true` |
| `DD_API_KEY` | **Required**. Datadog API Key. Sets the `DD_API_KEY` environment variable on your Container App. For more information about getting a Datadog API key, see the [API key documentation][1]. | `export DD_API_KEY=<API_KEY>` |
| `DD_SITE` | Set which Datadog site to send data to. Possible values are `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, `ap1.datadoghq.com`, `ap2.datadoghq.com`, and `ddog-gov.com`. The default is `datadoghq.com`. | `export DD_SITE=datadoghq.com` |

### Arguments

Configuration can be done using command-line arguments or a JSON configuration file (see the next section).

#### `instrument`
You can pass the following arguments to `instrument` to specify its behavior. These arguments override the values set in the configuration file, if any.

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--subscription-id` | `-s` | Subscription ID of the Azure subscription containing the Container App. Must be used with `--resource-group` and `--name`. |  |
| `--resource-group` | `-g` | Name of the Azure Resource Group containing the Container App. Must be used with `--subscription-id` and `--name`. |  |
| `--name` | `-n` | Name of the Azure Container App to instrument. Must be used with `--subscription-id` and `--resource-group`. |  |
| `--resource-id` | `-r` | Full Azure resource ID to instrument. Can be specified multiple times. Format: `/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name>`. |  |
| `--env-vars` | `-e` | Additional environment variables to set for the Container App. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2` |  |
| `--config` |  | Path to the configuration file. |  |
| `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply. | `false` |
| `--service` |  | The value for the service tag. Use this to group related Container Apps belonging to similar workloads. For example, `my-service`. If not provided, the Container App name is used. |  |
| `--env` or `--environment` |  | The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`. |  |
| `--version` |  | The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`. |  |
| `--sidecar-name` |  | (Not recommended) The name to use for the sidecar container. | `DEFAULT_SIDECAR_NAME` |
| `--shared-volume-name` |  | (Not recommended) Specify a custom shared volume name. | `DEFAULT_VOLUME_NAME` |
| `--shared-volume-path` |  | (Not recommended) Specify a custom shared volume path. | `DEFAULT_VOLUME_PATH` |
| `--logs-path` |  | (Not recommended) Specify a custom log file path. Must begin with the shared volume path. | `DEFAULT_LOGS_PATH` |
| `--source-code-integration` or `--sourceCodeIntegration` |  | Whether to enable the Datadog Source Code integration. This will tag your service(s) with the Git respository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` |  | Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog Github integration installed. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--extra-tags` or `--extraTags` |  | Additional tags to add to the service in the format "key1:value1,key2:value2". |  |
<!-- END_USAGE:instrument -->

#### `uninstrument`
You can pass the following arguments to `uninstrument` to specify its behavior. These arguments override the values set in the configuration file, if any.

<!-- BEGIN_USAGE:uninstrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--subscription-id` | `-s` | Subscription ID of the Azure subscription containing the Container App. Must be used with `--resource-group` and `--name`. |  |
| `--resource-group` | `-g` | Name of the Azure Resource Group containing the Container App. Must be used with `--subscription-id` and `--name`. |  |
| `--name` | `-n` | Name of the Azure Container App to instrument. Must be used with `--subscription-id` and `--resource-group`. |  |
| `--resource-id` | `-r` | Full Azure resource ID to instrument. Can be specified multiple times. Format: `/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name>`. |  |
| `--env-vars` | `-e` | Additional environment variables to set for the Container App. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2` |  |
| `--config` |  | Path to the configuration file. |  |
| `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply. | `false` |
| `--sidecar-name` |  | The name of the sidecar container to remove. Specify if you have a different sidecar name. | `DEFAULT_SIDECAR_NAME` |
| `--shared-volume-name` |  | The name of the shared volume to remove. Specify if you have a different shared volume name. | `DEFAULT_VOLUME_NAME` |
<!-- END_USAGE:uninstrument -->

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and run the `datadog-ci container-app instrument --config datadog-ci.json` command. Specify the `datadog-ci.json` file using the `--config` argument, and use this configuration file structure:

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
      "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name1>",
      "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name2>"
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
export DD_API_KEY=<your-api-key>
export DD_SITE=datadoghq.com

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app
```

### Instrumentation with tags and version

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=<your-api-key>

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
export DD_API_KEY=<your-api-key>

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app \
  --log-path /home/LogFiles/myapp/*.log \
```


### Dry run to preview changes

```bash
export DD_BETA_COMMANDS_ENABLED=true
export DD_API_KEY=<your-api-key>

datadog-ci container-app instrument \
  --subscription-id 12345678-1234-1234-1234-123456789012 \
  --resource-group my-resource-group \
  --name my-container-app \
  --dry-run
```

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
