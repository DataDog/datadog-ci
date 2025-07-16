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

# Ensure .NET settings are added for a containerized app
# Note: .NET settings are automatically added for .NET runtime apps
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
