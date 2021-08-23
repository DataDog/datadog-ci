# Sourcemaps command

Upload JS sourcemaps to Datadog to un-minify your errors.

## Usage

### Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By defaut the requests are sent to Datadog US.

It is also possible to override the full URL for the intake endpoint by defining the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.



### Commands

#### `upload`

This command will upload all javascript sourcemaps and their corresponding javascript file to Datadog in order to un-minify front-end stack traces received by Datadog.

To upload the sourcemaps in the build folder, this command should be run:

```bash
datadog-ci sourcemaps upload ./build --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234
```

* The first positional argument is the directory in which sourcemaps are located. The CLI will look for all `.js.map` files in this folder and subfolders recursively. The corresponding JS file should be located in the same folder as the sourcemaps it applies to (for example, `common.min.js.map` and `common.min.js` should be in the same directory).
The folder structure should match the structure of the served static files.

* `--service` (required) should be set as the name of the service you're uploading sourcemaps for, and Datadog will use this service name to find the corresponding sourcemaps based on the `service` tag set on the RUM SDK.

* `--release-version` (required) is similar and will be used to match the `version` tag set on the RUM SDK.

* `--minified-path-prefix` (required) should be a prefix common to all your JS source files, depending on the URL they are served from. The prefix can be a full URL or an absolute path.
Example: if you're uploading `dist/file.js` to `https://example.com/static/file.js`, you can use `datadog-ci sourcemaps upload ./dist --minified-path-prefix https://example.com/static/` or `datadog-ci sourcemaps upload ./dist --minified-path-prefix /static/`.
`--minified-path-prefix /` is a valid input when you upload JS at the root directory of the server.

In addition, some optional parameters are available:

* `--concurrency` (default: `20`): number of concurrent upload to the API.
* `--disable-git` (default: false): prevents the command from invoking git in the current working directory and sending repository related data to Datadog (hash, remote URL and the paths within the repository of the sources referenced in the sourcemap).
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.
* `--project-path` (default: empty): the path of the project where the sourcemaps were built. This will be stripped off from sources paths referenced in the sourcemap so they can be properly matched against tracked files paths.
* `--repository-url` (default: empty): overrides the repository remote with a custom URL. For example: https://github.com/my-company/my-project

#### Link errors with your source code

In addition to sending source maps, the sourcemaps upload command reports Git information such as the current commit hash, the repository URL, and the list of tracked file paths in the code repository. This requires the `git` program and also the current working directory to be inside a git repository.
Each sourcemap uploaded will get such information associated with it.

The repository URL is infered from the remote named `origin` (or the first remote if none are named `origin`). The value can be overriden by using the `--repository-url` flag.
For example: The remote `git@github.com:DataDog/example.git` will create links that point to `https://github.com/DataDog/example`.

The only repository URLs supported are the ones whose host contains: `github`, `gitlab` or `bitbucket`. This allows DataDog to create proper URLs such as:

| Provider  | URL |
| --- | --- |
| GitHub / GitLab  | https://<repository-url>/blob/<commit-hash>/<tracked-file-path>#L<line> |
| Bitbucket | https://<repository-url>/src/<commit-hash>/<tracked-file-path>#lines-<line>  |

Only tracked files paths related to the sourcemap being uploaded are gathered.
For example: A sourcemap containing inside its `sources` attribute `["webpack:///./src/folder/example.ts"]` will have associated with it all tracked file paths with `example.ts` as filename.

The following warning will be displayed if none of the filenames inside a sourcemap `sources` attribute are found within tracked files:
`Could not attach git data for sourcemap ...`

### End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'
export DATADOG_APP_KEY='<application key>'

TEMP_DIR=$(mktemp -d)
echo '{}' > $TEMP_DIR/fake.js
echo '{"version":3,"file":"out.js","sourceRoot":"","sources":["fake.js"],"names":["src"],"mappings":"AAgBC"}' > $TEMP_DIR/fake.js.map
yarn launch sourcemaps upload $TEMP_DIR/ --service test_datadog-ci --release-version 0.0.1 --minified-path-prefix https//fake.website
rm -rf $TEMP_DIR
```

Successful output should look like this:

```bash
Starting upload with concurrency 20.
Will look for sourcemaps in /var/folders/s_/ds1hc9g54k7ct8x7p3kwsq1h0000gn/T/tmp.fqWhNgGdn6/
Will match JS files for errors on files starting with https//fake.website
version: 0.0.1 service: test_datadog-ci project path:
Uploading sourcemap /var/folders/s_/ds1hc9g54k7ct8x7p3kwsq1h0000gn/T/tmp.fqWhNgGdn6/fake.js.map for JS file available at https//fake.website/fake.js
✅ Uploaded 1 files in 0.68 seconds.
```
