# Android ProGuard and R8 mappings

Upload a Java/Kotlin obfuscation mapping independently of Flutter, Unity, Gradle, or MSBuild:

```sh
export DATADOG_API_KEY=<API_KEY>
datadog-ci android-symbols upload ./mapping.txt \
  --build-id-file ./datadog.buildId --service my-app --version 1.0.0
```

The build ID must be the value packaged in the application's `assets/datadog.buildId`.
The Datadog Gradle plugin generates that asset for Gradle applications. The MAUI SDK
exports the mapping and ID together in `bin/<configuration>/<framework>/datadog-android-symbols/`.
Archive and upload those exact files from the build you distribute, including when uploading in a separate CI job.
This command never generates an ID and never falls back to matching by service/version.

| Argument                        | Description                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| `<mapping-file>`                | Required, non-empty ProGuard/R8 mapping file.                                           |
| `--build-id-file`               | Read the application's build ID from a file. Provide this or `--build-id`, exclusively. |
| `--build-id`                    | Explicit build ID already packaged in the application.                                  |
| `--service`                     | Required service name, included as upload metadata.                                     |
| `--version`                     | Required application version, included as upload metadata.                              |
| `--variant`                     | Optional application variant; defaults to an empty string.                              |
| `--config`                      | Datadog CI configuration file.                                                          |
| `--disable-git`                 | Skip Git metadata and source-code integration.                                          |
| `--repository-url`              | Override the repository URL collected from Git.                                         |
| `--dry-run`                     | Validate inputs and show metadata without uploading.                                    |
| `--fips`, `--fips-ignore-error` | Configure FIPS following other Datadog CI commands.                                     |

Set `DATADOG_SITE` (or `DD_SITE`) for a site other than `datadoghq.com`.
`DD_API_KEY` and the standard Datadog CI configuration files are also supported.
Invalid inputs and failed uploads return a non-zero exit code. Native `.so` symbol
upload and C# Portable PDB upload use their respective commands.
