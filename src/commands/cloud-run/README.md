## Troubleshooting Cloud Run Instrumentation

To troubleshoot issues you may be encountering with Datadog monitoring on your Cloud Run services, use the `datadog-ci cloud-run flare` command in the root of your project directory. This command collects important data about a Cloud Run service, such as environment variables and configuration information. These files will be submitted to Datadog support via a ticket matching the provided Zendesk case ID.

**Examples**
```bash
# Collect and send files to Datadog support for a single service
datadog-ci cloud-run -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id>

# Include recent logs
datadog-ci cloud-run -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id> --with-logs

# Dry run: collect data, but don't send to Datadog support
datadog-ci cloud-run -s <service> -p <project> -r <region/location> -c <case-id> -e <email-on-case-id> --with-logs --dry-run
```

**Arguments**

| Argument              | Shorthand | Description                                                                                                                 | Default |
|-----------------------|-----------|-----------------------------------------------------------------------------------------------------------------------------|---------|
| `--service`           | `-s`      | The name of the Cloud Run service.                                                                                          |         |
| `--project`           | `-p`      | The name of the Google Cloud project within which the Cloud Run service is hosted.                                          |         |
| `--region`            | `-r`      | The region where the Cloud Run service is hosted.                                                                           |         |
| `--case-id`           | `-c`      | The Datadog case ID to send the files to.                                                                                   |         |
| `--email`             | `-e`      | The email associated with the specified case ID.                                                                            |         |
| `--with-logs`         |           | Collect recent logs for the specified service.                                                                              | `false` |
| `--start` and `--end` |           | Define a time range in milliseconds since the Unix Epoch to gather logs within that range. (`--with-logs` must be included) |         |
| `--dry-run`           | `-d`      | Preview collected data which would be sent to Datadog support.                                                              | `false` |


## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-credentials-node.html
[2]: https://github.com/DataDog/datadog-ci
[3]: https://github.com/DataDog/datadog-lambda-layer-js/releases
[4]: https://github.com/DataDog/datadog-lambda-layer-python/releases
[5]: https://docs.datadoghq.com/serverless/datadog_lambda_library/extension
[6]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
[7]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-env-tag
[8]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-version-tag
[9]: https://docs.datadoghq.com/serverless/troubleshooting/serverless_tagging/#the-service-tag
[10]: https://docs.datadoghq.com/serverless/forwarder/
[11]: https://docs.datadoghq.com/serverless/custom_metrics?tab=python#enabling-asynchronous-custom-metrics
[12]: https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-profiles.html#using-profiles
[13]: https://docs.datadoghq.com/integrations/guide/source-code-integration
