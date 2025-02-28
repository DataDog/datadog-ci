# SBOM command

This command lets you upload SBOM files to the Datadog intake endpoint.


## Supported Formats

 - CycloneDX 1.4
 - CycloneDX 1.5
 - CycloneDX 1.6

## Usage

```bash
datadog-ci sbom upload [--env] [--no-ci-tags] [--git-repository] [--debug] <path/to/sbom.json>
```

### Optional arguments

- `--env` (default: `ci`): represents the environment in which you want your sbom to appear.
- `--no-ci-tags` (default: `false`): ignore continuous integration automatic detection of environment variables.
- `--git-repository` (default: `current working directory`): reports git environment context from specified repository.
- `--debug` (default: `false`): output debug logs.

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
