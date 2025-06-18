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
# Instrument a function by subscription ID, resource group, and app service name
datadog-ci aas instrument -s <subscription-id> -r <resource-group-name> -n <app-service-name>

# Dry run of all updates
datadog-ci aas instrument -s <subscription-id> -r <resource-group-name> -n <app-service-name> --dry-run
```
