# SBOM command

This command lets you upload SBOM files to the Datadog intake endpoint.


## Supported Formats

 - CycloneDX 1.4
 - CycloneDX 1.5

## Usage

```bash
datadog-ci sbom upload <path/to/sbom.json>
```

### Optional arguments

- `--service` should be set to the name of the service you're uploading SBOM reports from.
- `--env` is a string that represents the environment in which you want your tests to appear.

### Environment variables

The following environment variables must be defined:

 - `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site)
 - `DD_API_KEY`: the API key to use

## Development

When developing software, you can try with the following command:

```bash
yarn launch sbom upload --service <your-service> --env <your-environment> /path/to/sbom.json
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis
