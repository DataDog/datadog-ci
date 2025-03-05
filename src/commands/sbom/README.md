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
- `--no-ci-tags` (default: `false`): ignore the automatic detection of continuous integration environment variables.
- `--git-repository` (default: `current working directory`): reports git environment context from the specified repository.
- `--debug` (default: `false`): output debug logs.

### Environment variables

The following environment variables must be defined:

 - `DD_SITE`: the [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site)
 - `DD_APP_KEY`: the App key to use
 - `DD_API_KEY`: the API key to use

### Git context resolution

The Git context is resolved in the following order of priority:
1. Current process location
2. CI environment variables (can be disabled with: `--no-ci-tags` option)
3. Explicitly provided Git repository (through --git-repository option)
4. Override environment variables (`DD_GIT_*` variables)

## Development

When developing software, you can try with the following command:

```bash
yarn launch sbom upload /path/to/sbom.json
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis
