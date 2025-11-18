You can use the CLI to instrument your Azure App Services with Datadog. The CLI enables instrumentation by modifying existing App Services' configuration and hence does *not* require redeployment. It is the quickest way to get started with Datadog serverless monitoring.

You can also add the command to your CI/CD pipelines to enable instrumentation for *all* your serverless applications. Run the command *after* your normal serverless application deployment, so that changes made by the Datadog CLI command do not get overridden.

## Installation

To instrument your App Services using the `datadog-ci aas instrument` command, follow the instructions for a specific runtime listed below:

| OS      | Runtime   | Documentation                                                                                                                |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Windows | .NET      | [Windows .NET setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows?tab=net#setup)      |
| Windows | Java      | [Windows Java setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows?tab=java#setup)     |
| Windows | Node      | [Windows Node setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows?tab=nodejs#setup)   |
| Linux   | .NET      | [Linux .NET setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_linux?tab=nodenetphppython)   |
| Linux   | Node      | [Linux Node setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_linux?tab=nodenetphppython)   |
| Linux   | PHP       | [Linux PHP setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_linux?tab=nodenetphppython)    |
| Linux   | Java      | [Linux Java setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_linux?tab=java)               |
| Linux   | Python    | [Linux Python setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_linux?tab=nodenetphppython) |
| Linux   | Container | [Linux Container setup](https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_container)               |


## Commands

### `instrument`

Run `datadog-ci aas instrument` to apply Datadog instrumentation to an App Service. This command adds a sidecar to the App Service and modifies its configuration.

```bash
export DD_API_KEY=<your-datadog-api-key>
export DD_SITE=<your-datadog-site>

# Instrument an app service/web app by subscription ID, resource group, and app service name
datadog-ci aas instrument -s <subscription-id> -g <resource-group-name> -n <app-service-name>

# Dry run of instrumentation
datadog-ci aas instrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> --dry-run

# Instrument specific web app resource IDs
datadog-ci aas instrument \
  -r /subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Web/sites/<web-app-name> \
  -r /subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Web/sites/<web-app-name>

# Enable specific features via app settings/env vars 
datadog-ci aas instrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> -e DD_PROFILING_ENABLED=true -e DD_LOGS_INJECTION=true

# Specify Unified Service Tagging
datadog-ci aas instrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> --service <service-name> --env <environment-name> --version <version-name>

# For containerized apps, ensure .NET settings are added. For .NET runtime apps, .NET settings are automatically added.
datadog-ci aas instrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> --dotnet
```

### `uninstrument`

Run `datadog-ci aas uninstrument` to remove Datadog instrumentation to an App Service. This command removes the previously added sidecar to the App Service and modifies its configuration.

```bash
# Uninstrument an app service/web app by subscription ID, resource group, and app service name
datadog-ci aas uninstrument -s <subscription-id> -g <resource-group-name> -n <app-service-name>

# Dry run of uninstrumentation
datadog-ci aas uninstrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> --dry-run

# Uninstrument specific web app resource IDs
datadog-ci aas uninstrument \
  -r /subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Web/sites/<web-app-name> \
  -r /subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.Web/sites/<web-app-name>

# Remove previously set additional app settings/env vars 
datadog-ci aas uninstrument -s <subscription-id> -g <resource-group-name> -n <app-service-name> -e DD_PROFILING_ENABLED=true -e DD_LOGS_INJECTION=true
```

### Arguments

Configuration can be done using command-line arguments or a JSON configuration file (see the next section).

#### `instrument`
You can pass the following arguments to `instrument` to specify its behavior. These arguments override the values set in the configuration file, if any.

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes | `false` |
| `--subscription-id` | `-s` | Azure Subscription ID containing the App Service |  |
| `--resource-group` | `-g` | Name of the Azure Resource Group containing the App Service |  |
| `--name` | `-n` | Name of the Azure App Service to instrument |  |
| `--resource-id` | `-r` | Full Azure resource IDs to instrument, for example, "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Web/sites/{aasName}" |  |
| `--env-vars` | `-e` | Additional environment variables to set for the App Service. Can specify multiple in the form `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
| `--config` |  | Path to the configuration file |  |
| `--service` |  | The value for the service tag. For example, `my-service` |  |
| `--env` or `--environment` |  | The value for the env tag. For example, `prod` |  |
| `--version` |  | The value for the version tag. For example, `1.0.0` |  |
| `--instance-logging` |  | When enabled, log collection is automatically configured for an additional file path: /home/LogFiles/*$COMPUTERNAME*.log | `false` |
| `--log-path` |  | Where you write your logs. For example, /home/LogFiles/*.log or /home/LogFiles/myapp/*.log |  |
| `--no-restart` |  | Do not restart the App Service after applying instrumentation. | `false` |
| `--dotnet` or `--dotnet-container` |  | Add in required .NET-specific configuration options, is automatically inferred for code runtimes. This should be specified if you are using a containerized .NET app. | `false` |
| `--musl` |  | Add in required .NET-specific configuration options for musl-based .NET apps. This should be specified if you are using a containerized .NET app on a musl-based distribution like Alpine Linux. | `false` |
| `--source-code-integration` or `--sourceCodeIntegration` |  | Enable source code integration to add git metadata as tags. Defaults to enabled. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` |  | Upload git metadata to Datadog. Defaults to enabled. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--extra-tags` or `--extraTags` |  | Additional tags to add to the service in the format "key1:value1,key2:value2" |  |
<!-- END_USAGE:instrument -->

#### `uninstrument`
You can pass the following arguments to `uninstrument` to specify its behavior. These arguments override the values set in the configuration file, if any.

<!-- BEGIN_USAGE:uninstrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes | `false` |
| `--subscription-id` | `-s` | Azure Subscription ID containing the App Service |  |
| `--resource-group` | `-g` | Name of the Azure Resource Group containing the App Service |  |
| `--name` | `-n` | Name of the Azure App Service to instrument |  |
| `--resource-id` | `-r` | Full Azure resource IDs to instrument, for example, "/subscriptions/{subscriptionId}/resourceGroups/{resourceGroup}/providers/Microsoft.Web/sites/{aasName}" |  |
| `--env-vars` | `-e` | Additional environment variables to set for the App Service. Can specify multiple in the form `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
| `--config` |  | Path to the configuration file |  |
<!-- END_USAGE:uninstrument -->

### Configuration file

Instead of supplying arguments, you can create a configuration file in your project and run the `datadog-ci container-app instrument --config datadog-ci.json` command. Specify the `datadog-ci.json` file using the `--config` argument, and use this configuration file structure:

```json
{
  "aas": {
    "subscriptionId": "your-subscription-id",
    "resourceGroup": "your-resource-group",
    "aasName": "your-web-app-name",
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
  "aas": {
    "resourceIds": [
      "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name1>",
      "/subscriptions/<subscription-id>/resourceGroups/<resource-group-name>/providers/Microsoft.App/containerApps/<container-app-name2>"
    ],
    "service": "my-service",
    "environment": "prod"
  }
}
```
