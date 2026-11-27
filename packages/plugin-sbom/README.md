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

 - `DD_SITE`: Your [Datadog site](https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site). For example, `datadoghq.com` or `datadoghq.eu`.
 - Either `DD_ACCESS_TOKEN`, or both `DD_API_KEY` and `DD_APP_KEY`. See [Authentication](https://github.com/DataDog/datadog-ci#authentication).

Optional environment variables:
 - `DD_SUBDOMAIN`: If you have a [custom sub-domain enabled](https://docs.datadoghq.com/account_management/multi_organization/#custom-sub-domains) for your organization, set this variable to your subdomain. This ensures that the link to the Datadog Application, which the library logs after uploading, points to the correct location.

### Git context resolution

The Git context is resolved in the following order of priority (highest first):
1. Override environment variables (`DD_GIT_*`).
2. The readable checkout selected by `--git-repository`, or the current process location.
3. CI environment variables when the checkout cannot be read (unless `--no-ci-tags` is set).

For a detached checkout, CI can supply its branch, tag and canonical repository URL when the checkout revision and repository identity match. Identity is established by a matching workspace root or repository URL, including a checkout remounted inside a container.

A branch is optional for detached or tag-triggered checkouts. Known tags remain in `git.tag`; the CLI does not substitute a tag name or `HEAD` for an unknown branch.

## Development

When developing software, you can try with the following command:

```bash
yarn launch sbom upload /path/to/sbom.json
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Static Analysis][1]

[1]: https://docs.datadoghq.com/static_analysis
