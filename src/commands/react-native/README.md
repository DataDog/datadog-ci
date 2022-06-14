# React-native command

Upload React Native sourcemaps to Datadog to un-minify your errors.

## Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By defaut the requests are sent to Datadog US.

It is also possible to override the full URL for the intake endpoint by defining the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

## Commands

### `upload`

This command will upload all javascript sourcemaps and their corresponding bundle file to Datadog in order to un-minify front-end stack traces received by Datadog.

To upload the sourcemaps for iOS, this command should be run:

```bash
datadog-ci react-native upload --platform ios --service com.company.app --bundle ./main.jsbundle --sourcemap ./main.jsbundle.map --release-version 1.23.4
```

To upload the sourcemaps for android, this command should be run:

```bash
datadog-ci react-native upload --platform android --service com.company.app --bundle ./index.android.bundle --sourcemap ./index.android.bundle.map --release-version 1.23.4
```

* `--platform` identifies whether you are uploading ios or android sourcemaps.
It is not used in most cases. 

* `--service` (required) should be set as the name of the service you're uploading sourcemaps for, and Datadog will use this service name to find the corresponding sourcemaps based on the `service` tag set on the RUM SDK.
It is recommended to set it to your app's bundle identifier.

* `--bundle` (required) should be set to the path to your generated js bundle file, `main.jsbundle` for iOS or `index.android.bundle` for Android.

* `--sourcemap` (required) should be set to the path to your generated sourcemap file, `main.jsbundle.map` for iOS or `index.android.bundle.map` for Android.

* `--release-version` (required) is similar and will be used to match the `version` tag set on the RUM SDK.

In addition, some optional parameters are available:

* `--max-concurrency` (default: `20`): number of concurrent upload to the API.
* `--disable-git` (default: false): prevents the command from invoking git in the current working directory and sending repository related data to Datadog (hash, remote URL and the paths within the repository of the sources referenced in the sourcemap).
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.
* `--repository-url` (default: empty): overrides the repository remote with a custom URL. For example: https://github.com/my-company/my-project

### Link errors with your source code

Errors in Datadog UI can be enriched with links to GitHub/GitLab/Bitbucket if these requirements are met:
- `git` executable is installed
- `datadog-ci` is run within the git repository

When these requirements are met, the upload command reports Git information such as:
- the current commit hash
- the repository URL
- for each sourcemap, the list of file paths that are tracked in the repository. Only tracked file paths that could be related to a sourcemap are gathered.
<!-- Check this part -->
For example, for a sourcemap referencing `["/Users/myname/path/to/ReactNativeApp/example.ts"]` inside its `sources` attribute, the command will gather all file paths with `example.ts` as filename.

#### Override repository URL

The repository URL is inferred
- from the remote named `origin` if present
- from the first remote otherwise

The value can be overriden with `--repository-url`.

Example: With a remote `git@github.com:Datadog/example.git`, links pointing to `https://github.com/Datadog/example` are generated.
This behavior can be overriden with links to `https://gitlab.com/Datadog/example` with the flag `--repository-url=https://gitlab.com/Datadog/example`.

#### Setting the project path

TODO
#### Supported repositories

The only repository URLs supported are the ones whose host contains: `github`, `gitlab` or `bitbucket`. This allows Datadog to create proper URLs such as:

| Provider  | URL |
| --- | --- |
| GitHub / GitLab  | https://\<repository-url\>/blob/\<commit-hash\>/\<tracked-file-path\>#L\<line\> |
| Bitbucket | https://\<repository-url\>/src/\<commit-hash\>/\<tracked-file-path\>#lines-\<line\>  |

## End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

TODO
