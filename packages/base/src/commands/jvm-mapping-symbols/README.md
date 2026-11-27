# JVM Mapping Symbols

Upload a JVM (R8 or ProGuard) mapping file to Datadog, keyed by a build ID, to deobfuscate the Java and Kotlin frames of errors from Android apps that aren't built with the Datadog Android Gradle plugin, such as .NET MAUI apps.

Apps built with Gradle should keep using the [Datadog Android Gradle plugin][3], which uploads mapping files for you.

## Setup

You need to set the `DATADOG_API_KEY` environment variable, or add it to your `datadog-ci.json` file with the `apiKey` field.

Additional environment variables available:

| Environment Variable | Description                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATADOG_API_KEY`    | (Required) The API key used to authenticate the requests.                                                          |
| `DD_SITE`            | The Datadog site to upload the symbols to, e.g. `datadoghq.com`, `datadoghq.eu`, etc. Defaults to `datadoghq.com`. |

## Commands

### `upload`

Use the `upload` command to upload the mapping file of a build of your app.

```bash
datadog-ci jvm-mapping-symbols upload <mapping-file> --build-id-file <path> --service-name <service> --version <version>
```

- `<mapping-file>` (required): the mapping file the build produced, for example `mapping.txt`.
- The build ID must be the one the app ships in its `assets/datadog.buildId` file. The Datadog Android SDK sends it with every event, and when an event has one, the backend uses it, and only it, to find the mapping file. Give it with exactly one of `--build-id` or `--build-id-file`.

| Parameter             | Condition | Description                                                                                                                          |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--build-id`          | Required¹ | The build ID of the app, as a UUID (for example `01234567-89ab-cdef-0123-456789abcdef`).                                             |
| `--build-id-file`     | Required¹ | A file holding the build ID of the app, such as the `datadog.buildId` file it ships.                                                 |
| `--service-name`      | Required  | The service name of the app.                                                                                                         |
| `--version`           | Required  | The version of the app.                                                                                                              |
| `--variant`           | Optional  | The variant (flavor) of the app. Defaults to none.                                                                                   |
| `--dry-run`           | Optional  | Runs the command without the final upload step. All other checks are performed. Defaults to `false`.                                 |
| `--repository-url`    | Optional  | Overrides the remote repository URL used for git metadata, instead of the one derived from the local `.git` directory.               |
| `--disable-git`       | Optional  | Disables the collection of git metadata (repository URL, commit hash) for the uploaded file. Defaults to `false`.                    |
| `--config`            | Optional  | Path to a `datadog-ci.json` config file, as described in [Configuration][1]. Defaults to `datadog-ci.json` in the current directory. |
| `--fips`              | Optional  | Enables FIPS mode. See [FIPS support][2].                                                                                            |
| `--fips-ignore-error` | Optional  | Ignores errors related to FIPS mode. See [FIPS support][2].                                                                          |

¹ Exactly one of `--build-id` and `--build-id-file` is required.

#### Build ID

- The build ID is sent exactly as it is in the app, apart from surrounding whitespace: the backend compares it as text, so a different case wouldn't match.
- The backend keeps one mapping file per build ID, service, version and variant, and ignores later uploads of the same one, even though the command reports them as uploaded. Each build of the app should ship a new build ID.
- To fix a mapping file uploaded with the wrong service, version or variant, delete it before uploading it again: otherwise both are kept for the same build ID, and either one can be used.
- Upload the mapping file before releasing the app: errors received before it's available are grouped in Error Tracking with their obfuscated frames.
- The build ID file must not start with a byte order mark (BOM), which the Datadog Android SDK would keep as part of the ID: the command rejects such a file.

The command ends with the same summary line as the other symbol commands. Like them, it exits with `0` when the upload fails: check the summary.

[1]: https://github.com/DataDog/datadog-ci#configuration
[2]: https://github.com/DataDog/datadog-ci#fips-support
[3]: https://github.com/DataDog/dd-sdk-android-gradle-plugin
