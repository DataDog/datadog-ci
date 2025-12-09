You can use the CLI to [instrument your Cloud Run services](https://docs.datadoghq.com/serverless/google_cloud_run) with Datadog. The CLI enables instrumentation by modifying existing Cloud Run services' configuration.

## Commands

### `instrument`

Run `datadog-ci cloud-run instrument` to apply Datadog instrumentation to a Cloud Run service. This command adds a sidecar container, a shared log volume, and adds required environment variables.

```bash
# Instrument multiple services specified by names
datadog-ci cloud-run instrument -p <gcp-project> -r us-central1 -s <service-name> -s <another-service-name>

# Instrument a service in interactive mode
datadog-ci cloud-run instrument -i

# Instrument a service with a pinned or custom sidecar image
datadog-ci cloud-run instrument -p <gcp-project> -r us-central1 -s <service-name> --sidecarImage gcr.io/datadoghq/serverless-init@sha256:<sha256>

# Dry run of all updates
datadog-ci cloud-run instrument -p <gcp-project> -r us-central1 -s <service-name> -d
```

### `uninstrument`

Run `datadog-ci cloud-run uninstrument` to revert Datadog instrumentation from a Cloud Run service. This command updates the configuration by removing the sidecar container, the shared log volume, and Datadog environment variables.

```bash
# Uninstrument multiple services specified by names
datadog-ci cloud-run instrument -p <gcp-project> -r us-central1 -s <service-name> -s <another-service-name>

# Uninstrument a service in interactive mode
datadog-ci cloud-run uninstrument -i

# Dry run of all updates
datadog-ci cloud-run uninstrument -p <gcp-project> -r us-central1 -s <service-name> -d
```

## Configuration

### GCP credentials

You must have valid [GCP credentials][1] configured with access to the Cloud Run services where you are running any `datadog-ci cloud-run` command. You can configure credentials by running `gcloud auth application-default login` and following the prompts in your browser.

### Environment variables

You must expose these environment variables in the environment where you are running `datadog-ci cloud-run instrument`:

| Environment Variable | Description | Example |
| -------------------- | ----------- | ------- |
| `DD_API_KEY`         | Datadog API Key. Sets the `DD_API_KEY` environment variable on your Cloud Run service. | `export DD_API_KEY=<API_KEY>` |
| `DD_SITE`            | Set which Datadog site to send data. Possible values are `datadoghq.com`, `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, `ap1.datadoghq.com`, `ap2.datadoghq.com`, and `ddog-gov.com`. The default is `datadoghq.com`. | `export DD_SITE=datadoghq.com` |

### Arguments

Configuration can be done using command-line arguments.

#### `instrument`
You can pass the following arguments to `instrument` to specify its behavior.

<!-- BEGIN_USAGE:instrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply. | `false` |
| `--extra-tags` or `--extraTags` |  | Add custom tags to your Cloud Run service in Datadog. Must be a list of `<key:><value>` separated by commas. |  |
| `--env-vars` | `-e` | Additional environment variables to set for the Cloud Run service. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
| `--project` | `-p` | The name of the Google Cloud project where the Cloud Run service is hosted. |  |
| `--service` or `--services` | `-s` | Cloud Run service(s) to instrument |  |
| `--interactive` | `-i` | Interactively choose which service gets instrumented. No need for other flags. | `false` |
| `--region` | `-r` | The region where the Cloud Run service is hosted. |  |
| `--log-level` or `--logLevel` |  | Specify your Datadog log level. |  |
| `--source-code-integration` or `--sourceCodeIntegration` |  | Whether to enable the Datadog Source Code integration. This tags your service(s) with the Git repository and the latest commit hash of the local directory. Specify `--no-source-code-integration` to disable. | `true` |
| `--upload-git-metadata` or `--uploadGitMetadata` |  | Whether to enable Git metadata uploading, as a part of the source code integration. Git metadata uploading is only required if you don't have the Datadog GitHub integration installed. Specify `--no-upload-git-metadata` to disable. | `true` |
| `--tracing` |  | Enables tracing of your application if the tracer is installed. Disable tracing by setting `--tracing false`. |  |
| `--service-tag` or `--serviceTag` |  | The value for the service tag. Use this to group related Cloud Run services belonging to similar workloads. For example, `my-service`. If not provided, the Cloud Run service name is used. |  |
| `--version` |  | The value for the version tag. Use this to correlate spikes in latency, load, or errors to new versions. For example, `1.0.0`. |  |
| `--env` |  | The value for the env tag. Use this to separate your staging, development, and production environments. For example, `prod`. |  |
| `--llmobs` |  | If specified, enables LLM Observability for the instrumented service(s) with the provided ML application name. |  |
| `--image` or `--sidecar-image` |  | The image to use for the sidecar container. | `gcr.io/datadoghq/serverless-init:latest` |
| `--sidecar-name` |  | (Not recommended) The name to use for the sidecar container. | `datadog-sidecar` |
| `--shared-volume-name` |  | (Not recommended) Specify a custom shared volume name. | `shared-volume` |
| `--shared-volume-path` |  | (Not recommended) Specify a custom shared volume path. | `/shared-volume` |
| `--logs-path` |  | (Not recommended) Specify a custom log file path. Must begin with the shared volume path. | `/shared-volume/logs/*.log` |
| `--sidecar-cpus` |  | The number of CPUs to allocate to the sidecar container. | `1` |
| `--sidecar-memory` |  | The amount of memory to allocate to the sidecar container. | `512Mi` |
| `--language` |  | Set the language used in your container or function for advanced log parsing. Sets the DD_SOURCE env var. Possible values: "nodejs", "python", "go", "java", "csharp", "ruby", or "php". |  |
<!-- END_USAGE:instrument -->

#### `uninstrument`
You can pass the following arguments to `uninstrument` to specify its behavior.

<!-- BEGIN_USAGE:uninstrument -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Run the command in dry-run mode, without making any changes. Preview the changes that running the command would apply. | `false` |
| `--project` | `-p` | The name of the Google Cloud project where the Cloud Run service is hosted. |  |
| `--service` or `--services` | `-s` | Cloud Run service(s) to revert instrumentation |  |
| `--interactive` | `-i` | Interactively choose which service gets instrumented. No need for other flags. | `false` |
| `--region` | `-r` | The region where the Cloud Run service is hosted. |  |
| `--sidecar-name` |  | The name of the sidecar container to remove. Specify if you have a different sidecar name. | `datadog-sidecar` |
| `--shared-volume-name` |  | The name of the shared volume to remove. Specify if you have a different shared volume name. | `shared-volume` |
| `--env-vars` | `-e` | Additional environment variables to remove from the Cloud Run service. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`. |  |
<!-- END_USAGE:uninstrument -->

#### `flare`
You can pass the following arguments to `flare` to specify its behavior.

<!-- BEGIN_USAGE:flare -->
| Argument | Shorthand | Description | Default |
| -------- | --------- | ----------- | ------- |
| `--dry` or `--dry-run` | `-d` | Preview data that will be sent to Datadog support. | `false` |
| `--with-logs` |  | Collect recent logs for the specified service. | `false` |
| `--service` | `-s` | The name of the Cloud Run service. |  |
| `--project` | `-p` | The name of the Google Cloud project where the Cloud Run service is hosted. |  |
| `--region` or `--location` | `-r` or `-l` | The region where the Cloud Run service is hosted. |  |
| `--case-id` | `-c` | The Datadog case ID to send the files to. |  |
| `--email` | `-e` | The email associated with the specified case ID. |  |
| `--start` |  | Only gather logs after the time in milliseconds since Unix Epoch. (`--with-logs` must be specified.) |  |
| `--end` |  | Only gather logs before the time in milliseconds since Unix Epoch. (`--with-logs` must be specified.) |  |
<!-- END_USAGE:flare -->

## Troubleshooting Cloud Run instrumentation

To troubleshoot issues you encounter with Datadog monitoring on your Cloud Run services, run the `datadog-ci cloud-run flare`  command in the root of your project directory. This command collects important data about the Cloud Run service, such as environment variables and the YAML config. These files are submitted to Datadog support via a ticket matching the provided Zendesk case ID.

**Note**: This command works regardless of whether your Cloud Run services were instrumented using `datadog-ci cloud-run instrument`.

### Examples
```bash
# Collect and send files to Datadog support for a single service
datadog-ci cloud-run flare -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id>

# Include recent logs
datadog-ci cloud-run flare -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id> --with-logs

# Dry run: collect data, but don't send to Datadog support
datadog-ci cloud-run flare -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id> --with-logs --dry-run
```

## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://cloud.google.com/sdk/gcloud/reference/auth/login
[2]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about instrumenting Google Cloud Run][1]

[1]: https://docs.datadoghq.com/serverless/google_cloud_run
