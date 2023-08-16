## Troubleshooting Cloud Run Instrumentation

To troubleshoot issues you encounter with Datadog monitoring on your Cloud Run services, run the `datadog-ci cloud-run flare` command in the root of your project directory. This command collects important data about the Cloud Run service, such as environment variables and configuration information. These files will be submitted to Datadog support via a ticket matching the provided Zendesk case ID.

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

| Argument              | Shorthand | Description                                                                                                               | Default |
|-----------------------|-----------|---------------------------------------------------------------------------------------------------------------------------|---------|
| `--service`           | `-s`      | The name of the Cloud Run service.                                                                                        |         |
| `--project`           | `-p`      | The name of the Google Cloud project where the Cloud Run service is hosted.                                               |         |
| `--region`            | `-r`      | The region where the Cloud Run service is hosted.                                                                         |         |
| `--case-id`           | `-c`      | The Datadog case ID to send the files to.                                                                                 |         |
| `--email`             | `-e`      | The email associated with the specified case ID.                                                                          |         |
| `--with-logs`         |           | Collect recent logs for the specified service.                                                                            | `false` |
| `--start` and `--end` |           | Only gather logs within the time range (`--with-logs` must be included.) Both arguments are numbers in milliseconds since Unix Epoch. |         |
| `--dry-run`           | `-d`      | Preview data that will be sent to Datadog support.                                                                        | `false` |


## Community

For product feedback and questions, join the `#serverless` channel in the [Datadog community on Slack](https://chat.datadoghq.com/).

[1]: https://cloud.google.com/sdk/gcloud/reference/auth/login
[2]: https://github.com/DataDog/datadog-ci
[3]: https://docs.datadoghq.com/serverless/google_cloud_run
[4]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
