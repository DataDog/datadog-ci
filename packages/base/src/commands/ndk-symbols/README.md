# NDK Symbols

Upload Android native libraries (`.so` files) to Datadog to symbolicate native crashes of Android apps that aren't built with the Datadog Android Gradle plugin, such as .NET MAUI apps.

Apps built with Gradle should keep using the [Datadog Android Gradle plugin][3], which uploads NDK symbol files for you.

## Setup

You need to set the `DATADOG_API_KEY` environment variable, or add it to your `datadog-ci.json` file with the `apiKey` field.

Additional environment variables available:

| Environment Variable | Description                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `DATADOG_API_KEY`    | (Required) The API key used to authenticate the requests.                                                          |
| `DD_SITE`            | The Datadog site to upload the symbols to, e.g. `datadoghq.com`, `datadoghq.eu`, etc. Defaults to `datadoghq.com`. |

## Commands

### `upload`

Use the `upload` command to upload the native libraries of a build of your app.

```bash
datadog-ci ndk-symbols upload <location> --build-id <build-id>
```

- `<location>` (required, variadic): one or more directories or file paths. Directories are scanned recursively for `.so` files.
- `--build-id` must be the build ID the app ships in its `assets/datadog.buildId` file. The Datadog Android SDK sends it with every native crash, and the backend uses it to find the symbols of that exact build.

| Parameter             | Condition | Description                                                                                                                          |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `--build-id`          | Required  | The build ID of the app, as a UUID (for example `01234567-89ab-cdef-0123-456789abcdef`).                                             |
| `--service-name`      | Optional  | The service name of the app.                                                                                                         |
| `--version`           | Optional  | The version of the app.                                                                                                              |
| `--variant`           | Optional  | The variant (flavor) of the app.                                                                                                     |
| `--dry-run`           | Optional  | Runs the command without the final upload step. All other checks are performed. Defaults to `false`.                                 |
| `--max-concurrency`   | Optional  | The number of concurrent upload requests to the API. Defaults to `20`.                                                               |
| `--repository-url`    | Optional  | Overrides the remote repository URL used for git metadata, instead of the one derived from the local `.git` directory.               |
| `--disable-git`       | Optional  | Disables the collection of git metadata (repository URL, commit hash) for the uploaded files. Defaults to `false`.                   |
| `--config`            | Optional  | Path to a `datadog-ci.json` config file, as described in [Configuration][1]. Defaults to `datadog-ci.json` in the current directory. |
| `--fips`              | Optional  | Enables FIPS mode. See [FIPS support][2].                                                                                            |
| `--fips-ignore-error` | Optional  | Ignores errors related to FIPS mode. See [FIPS support][2].                                                                          |

#### Which libraries are uploaded

- **As they are:** each library is uploaded unchanged, under its file name, which is how native crash frames show it. Upload the libraries under the names they have in the app package (APK or AAB): files whose name isn't `lib*.so` are skipped with a warning, because Android doesn't load them, so no crash frame can refer to them.
- **Architecture:** read from the library itself (its ELF header), not from the folder it's in. The supported architectures are the Android ones: `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`.
- **Only libraries with symbols:** a library with neither a symbol table nor debug info can't symbolicate anything, so it's skipped with a warning. Upload your libraries before they are stripped. Debug-only copies (files with no code, such as `objcopy --only-keep-debug` output) are skipped too.
- **One library per name and architecture:** for a given build ID, the backend stores one library per file name and architecture, and keeps the first one it receives. The same file found several times is uploaded once. If different libraries with the same name and architecture are found, none of them is uploaded, and they're reported as failures: upload only the libraries of the build that ships with that build ID.
- **Other files** (not ELF, not a shared library, big-endian, or another architecture) are skipped with a warning. Files and folders that can't be read are reported as failures.
- **Locations** are taken literally (characters such as `[` or `*` in a folder name aren't patterns), and symbolic links to folders are followed. A symbolic link is uploaded under its own name, so links can give libraries their app package names.
- **Only pass the app's libraries:** the command can't tell an Android library from another Linux library of the same architecture.

The command prints how many libraries were uploaded, skipped and failed, followed by the same summary line as the other symbol commands. Like them, it exits with `0` when uploads fail: check the summary.

[1]: https://github.com/DataDog/datadog-ci#configuration
[2]: https://github.com/DataDog/datadog-ci#fips-support
[3]: https://github.com/DataDog/dd-sdk-android-gradle-plugin
