## Overview

To un-minify errors, upload your React Native source maps to Datadog.

## Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

You can configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable as `datadoghq.eu`. By default, the requests are sent to Datadog US.

To make these variables available, Datadog recommends setting them in an encrypted `datadog-ci.json` file at the root of your project:

```json
{
  "apiKey": "<DATADOG_API_KEY>",
  "datadogSite": "<DATADOG_SITE>"
}
```

To override the full URL for the intake endpoint, define the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

## Commands

### `upload`

This command uploads your JavaScript source maps and their corresponding bundle file to Datadog in order to un-minify your application's stack traces.

To upload the source maps for iOS, run this command:

```bash
datadog-ci react-native upload --platform ios --service com.company.app --bundle ./main.jsbundle --sourcemap ./main.jsbundle.map --release-version 1.23.4 --build-version 1234
```

To upload the source maps for Android, run this command:

```bash
datadog-ci react-native upload --platform android --service com.company.app --bundle ./index.android.bundle --sourcemap ./index.android.bundle.map --release-version 1.23.4 --build-version 1234
```

| Parameter           | Condition | Description                                                                                                                                                                                                                                                                                                                                                     |
| ------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--platform`        | Required  | Identifies if you are uploading iOS or Android source maps.                                                                                                                                                                                                                                                                                                     |
| `--service`         | Required  | Set as the service name you are uploading source maps for. Datadog uses this service name to find corresponding source maps based on the `service` tag set on the RUM React Native SDK.<br>By default, the RUM React Native SDK uses your application's bundle identifier as the service.                                                                       |
| `--bundle`          | Required  | Must be set as the path to your generated JS bundle file, `main.jsbundle` for iOS and `index.android.bundle` for Android.                                                                                                                                                                                                                                       |
| `--sourcemap`       | Required  | Must be set to the path to your generated source map file, `main.jsbundle.map` for iOS and `index.android.bundle.map` for Android.                                                                                                                                                                                                                              |
| `--release-version` | Required  | Used to match the `version` tag set on the RUM React Native SDK. This should be the "Version" or "MARKETING_VERSION" in XCode for iOS and the "versionName" in your `android/app/build.gradle` for Android.                                                                                                                                                     |
| `--build-version`   | Required  | Used to avoid overwriting your source maps by accident. Only one upload is needed for a specific `build-version` and `service` combination. Subsequent uploads are ignored until the `build-version` changes. This should match the "Build" or "CURRENT_PROJECT_VERSION" in XCode for iOS and the "versionCode" in your `android/app/build.gradle` for Android. |

The following optional parameters are available:

| Parameter                  | Default | Description                                                                                                                                                                                                                     |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--disable-git`            | False   | Prevents the command from invoking git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--dry-run`                | False   | It runs the command without the final step of uploading. All other checks are performed.                                                                                                                                        |
| `--repository-url`         | Empty   | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`.                                                                                                                     |
| `--remove-sources-content` | False   | Removes the `"sourcesContent"` part of the source map files. This reduces the size of your files while retaining the unminification, but it also removes the code snippet next to the unminified error in Datadog.              |
| `--config`                 | Empty   | The path to your `datadog-ci.json` file, if it is not at the root of your project.                                                                                                                                              |

### Link errors with your source code

You can enrich errors in Datadog with context links to GitHub, GitLab, Bitbucket, and Azure DevOps if the following requirements are met:

- You have installed the `git` executable
- You can run `datadog-ci` in the git repository

When these requirements are met, the upload command reports git information such as:

- the current commit hash
- the repository URL
- the list of file paths that are tracked in the repository. Only tracked file paths related to a source map are gathered.

For example, for a sourcemap referencing `["/Users/myname/path/to/ReactNativeApp/example.ts"]` inside its `sources` attribute, the command gathers all file paths with `example.ts` as the file name.

#### Override repository URL

The repository URL is inferred from the remote named `origin` (if present). Otherwise, it is inferred from the first remote. The value can be overridden with `--repository-url`.

For example, with a remote like `git@github.com:Datadog/example.git`, links pointing to `https://github.com/Datadog/example` are generated.

You can override this behavior with links to `https://gitlab.com/Datadog/example` with the `--repository-url=https://gitlab.com/Datadog/example` flag.

#### Set the project path

By default, paths inside React Native source maps are the absolute paths of files on the machine where they were bundled (for example: `/Users/user/MyProject/App.ts`).

If you are not running the `react-native upload` command from your React Native project root, you need to specify the `--project-path` argument with the absolute path to your React Native project root.

#### Supported repositories

The supported repository URLs are ones whose host contains `github`, `gitlab`, `bitbucket`, or `dev.azure`.

This allows Datadog to create proper URLs such as:

| Provider         | URL                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub or GitLab | https://\<repository-url\>/blob/\<commit-hash\>/\<tracked-file-path\>#L\<line\>                                                                     |
| Bitbucket        | https://\<repository-url\>/src/\<commit-hash\>/\<tracked-file-path\>#lines-\<line\>                                                                 |
| Azure DevOps     | https://\<repository-url\>?version=GC\<commit-hash\>&path=\<tracked-file-path\>&line=\<line\>&lineEnd=\<line + 1>&lineStartColumn=1&lineEndColumn=1 |

### `codepush`

This command uploads your JavaScript source maps and their corresponding bundle file to Datadog after an AppCenter CodePush build.

To upload the source maps for an iOS app called "AppNameiOS" inside the "Company" organization after a build for the "Staging" deployment, run:

```bash
datadog-ci react-native codepush --platform ios --service com.company.app --bundle ./build/main.jsbundle --sourcemap ./build/main.jsbundle.map --app Company/AppNameiOS --deployment Staging
```

This command calls the `upload` command, setting the release version to `{releaseVersion}-codepush.{codepushLabel}`, such as `1.0.0-codepush.v4` for example.

| Parameter      | Condition | Description                                                                                                                                                                                                                                                                               |
| -------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--platform`   | Required  | Identifies if you are uploading iOS or Android source maps.                                                                                                                                                                                                                               |
| `--service`    | Required  | Set as the service name you are uploading source maps for. Datadog uses this service name to find corresponding source maps based on the `service` tag set on the RUM React Native SDK.<br>By default, the RUM React Native SDK uses your application's bundle identifier as the service. |
| `--bundle`     | Required  | Must be set as the path to your generated JS bundle file, `main.jsbundle` for iOS and `index.android.bundle` for Android.                                                                                                                                                                 |
| `--sourcemap`  | Required  | Must be set to the path to your generated source map file, `main.jsbundle.map` for iOS and `index.android.bundle.map` for Android.                                                                                                                                                        |
| `--app`        | Required  | The name of the target app in AppCenter. Must match the format OrganizationName/AppName.                                                                                                                                                                                                  |
| `--deployment` | Required  | The name of the deployment in AppCenter.                                                                                                                                                                                                                                                  |

The following optional parameters are available:

| Parameter                  | Default | Description                                                                                                                                                                                                                                                                                                   |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--disable-git`            | False   | Prevents the command from invoking git in the current working directory and sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map).                                                                               |
| `--dry-run`                | False   | It runs the command without the final step of uploading. All other checks are performed.                                                                                                                                                                                                                      |
| `--repository-url`         | Empty   | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`.                                                                                                                                                                                                   |
| `--build-version`          | 1       | Used to avoid overwriting your source maps by accident. Only one upload is needed for a specific `build-version` and `service` combination. Subsequent uploads are ignored until the `build-version` changes. This should not be necessary for CodePush unless you uploaded the wrong source maps by mistake. |
| `--remove-sources-content` | False   | Removes the `"sourcesContent"` part of the source map files. This reduces the size of your files while retaining the unminification, but it also removes the code snippet next to the unminified error in Datadog.                                                                                            |
| `--config`                 | Empty   | The path to your `datadog-ci.json` file, if it is not at the root of your project.                                                                                                                                                                                                                            |

### `xcode`

This command can be called from an XCode build phase to execute the `react-native bundle` command and upload the source maps.

The upload only happens when your target has a "Release" build configuration; that prevents overwriting existing source maps when running a build with another configuration such as "Debug".

You can use the same environment variables as the `upload` command: 

| Environment Variable           | Description                                                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `DATADOG_API_KEY`              | Your Datadog API key. (REQUIRED)
| `DATADOG_SITE`                 | Optional Datadog site (datadoghq.com, [us3, us5].datadoghq.com, datadoghq.eu, ddog-gov.com, ap1.datadoghq.com, ap2.datadoghq.com). By default, the requests are sent to Datadog US.
| `DATADOG_SOURCEMAP_INTAKE_URL` | Optional variable to override the full URL for the intake endpoint.
| `DATADOG_RELEASE_VERSION`      | Optional variable to override the version name for sourcemaps upload


#### For React Native >= 0.69:

To ensure environment variables are well propagated in the build phase, you need to create a `custom-react-native-xcode.sh` file in your `ios` folder:

```bash
#!/bin/sh
REACT_NATIVE_XCODE="../node_modules/react-native/scripts/react-native-xcode.sh"
DATADOG_XCODE="../node_modules/.bin/datadog-ci react-native xcode"

/bin/sh -c "$DATADOG_XCODE $REACT_NATIVE_XCODE"
```

This allows the file's path to be passed as one argument to the `with-environment.sh` script in the "Bundle React Native code and images" build phase:

```bash
set -e
export SOURCEMAP_FILE=$DERIVED_FILE_DIR/main.jsbundle.map
WITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"
REACT_NATIVE_XCODE="./custom-react-native-xcode.sh"

/bin/sh -c "$WITH_ENVIRONMENT $REACT_NATIVE_XCODE"
```

#### For React Native < 0.69:

Change the "Bundle React Native code and images" build phase:

```bash
set -e
../node_modules/.bin/datadog-ci react-native xcode ../node_modules/react-native/scripts/react-native-xcode.sh
```

#### Customize the command

The first positional argument is the React Native bundle script.

If you use another script that requires arguments, you need to put this script in a file (such as in `scripts/bundle.sh`) and provide this file path in the `datadog-ci react-native xcode` command.

| Parameter                 | Default                                                       | Description                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--service`               | Required                                                      | Set as the service name you are uploading source maps for (if it is not your bundle identifier). You can also specify a `SERVICE_NAME_IOS` environment variable.          |
| `--force`                 | False                                                         | Force the upload of the source maps, even if the build configuration is not "Release".                                                                                    |
| `--dry-run`               | False                                                         | Run the command without the final step of uploading. The bundle script is executed and all other checks are performed.                                                    |
| `--composeSourcemapsPath` | `../node_modules/react-native/scripts/compose-source-maps.js` | If you use Hermes, you need to compose the source maps after the bundle phase. Only use this argument if your node modules are not on the same level as the `ios` folder. |

The following optional parameters are available:

| Parameter                  | Default | Description                                                                                                                                                                                                                          |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--disable-git`            | False   | Prevents the command from invoking git in the current working directory and from sending repository-related data to Datadog (such as the hash, remote URL, and paths within the repository of sources referenced in the source map). |
| `--repository-url`         | Empty   | Overrides the remote repository with a custom URL. For example, `https://github.com/my-company/my-project`.                                                                                                                          |
| `--remove-sources-content` | False   | Removes the `"sourcesContent"` part of the source map files. This reduces the size of your files while retaining the unminification, but it also removes the code snippet next to the unminified error in Datadog.                   |
| `--config`                 | Empty   | The path to your `datadog-ci.json` file, if it is not at the root of your project.                                                                                                                                                   |

### `inject-debug-id`

The inject-debug-id command adds a debug ID to your JavaScript bundle and its sourcemap.

A debug ID allows Datadog to reliably match error stack traces from your application to the correct uploaded debug symbols (sourcemaps), ensuring accurate error resolution.

To inject the debug ID, run the following command:

```bash
datadog-ci react-native inject-debug-id ./dist
```

The expected path is a folder containing both the JS bundle and the sourcemap for your build (for example, index.android.bundle and index.android.bundle.map).

The `--dry-run` optional parameter is also available, to run the command without actually injecting the debug ID in your files.

## End-to-end testing process

### `upload`

To verify this command works as expected, you can trigger a test run and verify that it returns 0:

```bash
export DATADOG_API_KEY='<API key>'

TEMP_DIR=$(mktemp -d)
echo '{}' > $TEMP_DIR/fake.js
echo '{"version":3,"file":"out.js","sourceRoot":"","sources":["fake.js"],"names":["src"],"mappings":"AAgBC"}' > $TEMP_DIR/fake.js.map
yarn launch react-native upload --platform ios --service com.company.app --bundle $TEMP_DIR/fake.js --sourcemap $TEMP_DIR/fake.js.map --release-version 0.0.1 --build-version 000001
rm -rf $TEMP_DIR
```

A successful output should look like this:

```bash
Starting upload.
Upload of /var/folders/34/_7q54_lx4nl1cvkjwr3_k4lw0000gq/T/tmp.x0vecv3yFT/fake.js.map for bundle /var/folders/34/_7q54_lx4nl1cvkjwr3_k4lw0000gq/T/tmp.x0vecv3yFT/fake.js on platform ios with project path /Users/me/datadog-ci
version: 0.0.1 service: com.company.app
⚠️ No tracked files found for sources contained in /var/folders/34/_7q54_lx4nl1cvkjwr3_k4lw0000gq/T/tmp.x0vecv3yFT/fake.js.map
Uploading sourcemap /var/folders/34/_7q54_lx4nl1cvkjwr3_k4lw0000gq/T/tmp.x0vecv3yFT/fake.js.map for JS file available at /var/folders/34/_7q54_lx4nl1cvkjwr3_k4lw0000gq/T/tmp.x0vecv3yFT/fake.js

Command summary:
✅ Uploaded 1 sourcemap in 0.698 seconds.
✨  Done in 2.50s.
```

### `codepush`

You need an AppCenter account to test this command, as it uses the `appcenter codepush deployment history` command.

Generate source maps for your CodePush application, then use `yarn launch react-native codepush` from this repository to trigger an upload.

### `xcode`

Build and link your local `datadog-ci` package by running this in the directory:

```bash
yarn build
yarn link
```

Run this command in your project:

```bash
yarn link @datadog/datadog-ci
```

If running `yarn datadog-ci` in your project returns `error Command "datadog-ci" not found.`, run the following:

```bash
chmod +x /path/to/datadog-ci/dist/cli.js
cp /path/to/datadog-ci/dist/cli.js /path/to/project/node_modules/.bin/datadog-ci
```

Then, follow the usual installation steps.


## Further reading

Additional helpful documentation, links, and articles:

- [Learn about React Native Crash Reporting and Error Tracking][1]

[1]: https://docs.datadoghq.com/real_user_monitoring/error_tracking/reactnative/
