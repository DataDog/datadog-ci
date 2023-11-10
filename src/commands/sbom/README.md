# SBOM uploader

<div class="alert alert-warning"><strong>Warning:</strong> The <code>SBOM upload</code> command is in beta. It requires you to set <code>DD_BETA_COMMANDS_ENABLED=1</code>, and should not be used in production.</div>

This command lets you upload SBOM files to the Datadog intake endpoint.


## Supported Formats

 - CycloneDX 1.4

## Usage

```bash
DD_BETA_COMMANDS_ENABLED=1 datadog-ci sbom upload --service <my-service> <path/to/sbom.json>
```

### Environment variables

The following environment variables must be defined:

 - `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site)
 - `DD_APP_KEY`: the App Key to use
 - `DD_API_KEY`: the API key to use
 - `DD_SERVICE`: the Datadog service you use (if `--service` not specified)


## Development

When developing software, you can try with the following command:

```bash
DD_BETA_COMMANDS_ENABLED=1 yarn launch sbom upload --service <your-service> --env <your-environment> /path/to/sbom.json
```
