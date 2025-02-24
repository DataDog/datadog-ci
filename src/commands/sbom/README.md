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

- `--env` is a string that represents the environment in which you want your tests to appear.

### Environment variables

The following environment variables must be defined:

 - `DATADOG_API_KEY` or `DD_API_KEY`: Set the API key to use. For more information about getting a Datadog API key, see the [API key documentation][2].
 - `DATADOG_APP_KEY` or `DD_APP_KEY`: Set the App key to use.
 - `DATADOG_SITE` or `DD_SITE`: Set the [Datadog site][3]. The default is `datadoghq.com`.

## Development

When developing software, you can try with the following command:

```bash
yarn launch sbom upload /path/to/sbom.json
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis
[2]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
[3]: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
