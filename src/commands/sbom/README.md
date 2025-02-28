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
- `--git-repository` (default: `current working directory`): reports git environment context from specified repository.

### Environment variables

The following environment variables must be defined:

 - `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site)
 - `DD_APP_KEY`: the App key to use
 - `DD_API_KEY`: the API key to use

## Development

When developing software, you can try with the following command:

```bash
yarn launch sbom upload /path/to/sbom.json
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis
