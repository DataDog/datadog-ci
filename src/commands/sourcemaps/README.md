# Sourcemaps command

Upload JavaScript sourcemaps to Datadog to un-minify your errors.

## Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By default the requests are sent to Datadog US.

It is also possible to override the full URL for the intake endpoint by defining the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

## Commands

### `upload`

This command will upload all JavaScript sourcemaps and their corresponding JavaScript bundles to Datadog in order to un-minify front-end stack traces received by Datadog.

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

* `--max-concurrency` (default: `20`): number of concurrent upload to the API.
* `--disable-git` (default: false): prevents the command from invoking git in the current working directory and sending repository related data to Datadog (hash, remote URL and the paths within the repository of the sources referenced in the sourcemap).
* `--quiet` (default: false): suppresses individual line output for each upload. Success and error logs are never suppressed.
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.
* `--project-path` (default: empty): the path of the project where the sourcemaps were built. This will be stripped off from sources paths referenced in the sourcemap so they can be properly matched against tracked files paths. See details in the [dedicated section](#setting-the-project-path).
* `--repository-url` (default: empty): overrides the repository remote with a custom URL. For example: https://github.com/my-company/my-project

### Link errors with your source code

Errors in Datadog UI can be enriched with links to GitHub/GitLab/Bitbucket/Azure DevOps if these requirements are met:
- `git` executable is installed
- `datadog-ci` is run within the git repository

When these requirements are met, the upload command reports Git information such as:
- the current commit hash
- the repository URL
- for each sourcemap, the list of file paths that are tracked in the repository. Only tracked file paths that could be related to a sourcemap are gathered.
For example, for a sourcemap referencing `["webpack:///./src/folder/example.ts"]` inside its `sources` attribute, the command will gather all file paths with `example.ts` as filename.

#### Override repository URL

The repository URL is inferred
- from the remote named `origin` if present
- from the first remote otherwise

The value can be overridden with `--repository-url`.

Example: With a remote `git@github.com:Datadog/example.git`, links pointing to `https://github.com/Datadog/example` are generated.
This behavior can be overridden with links to `https://gitlab.com/Datadog/example` with the flag `--repository-url=https://gitlab.com/Datadog/example`.

#### Setting the project path

If the file paths referenced by your sourcemaps have a prefix before the part relative to the repository root, you need to specify the `--project-path` argument.

For example, if your repository contains a file at `src/foo/example.js`, then:
  - if the path referenced in the sourcemap is `webpack://src/foo/example.js`, you don't need to use `--project-path`.
  - if the path referenced in the sourcemap is `webpack://MyProject/src/foo/example.js`, you need to use `--project-path MyProject/` for files to be correctly linked to your repository.

#### Supported repositories

The only repository URLs supported are the ones whose host contains: `github`, `gitlab`, `bitbucket`, or `dev.azure`. This allows Datadog to create proper URLs such as:

| Provider        | URL                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub / GitLab | https://\<repository-url\>/blob/\<commit-hash\>/\<tracked-file-path\>#L\<line\>                                                                     |
| Bitbucket       | https://\<repository-url\>/src/\<commit-hash\>/\<tracked-file-path\>#lines-\<line\>                                                                 |
| Azure DevOps    | https://\<repository-url\>?version=GC\<commit-hash\>&path=\<tracked-file-path\>&line=\<line\>&lineEnd=\<line + 1>&lineStartColumn=1&lineEndColumn=1 |

## End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'
export DATADOG_APP_KEY='<application key>'

TEMP_DIR=$(mktemp -d)
echo '{}' > $TEMP_DIR/fake.js
echo '{"version":3,"file":"out.js","sourceRoot":"","sources":["fake.js"],"names":["src"],"mappings":"AAgBC"}' > $TEMP_DIR/fake.js.map
yarn launch sourcemaps upload $TEMP_DIR/ --service test_datadog-ci --release-version 0.0.1 --minified-path-prefix https://fake.website
rm -rf $TEMP_DIR
```

Successful output should look like this:

```bash
Starting upload with concurrency 20.
Will look for sourcemaps in /var/folders/s_/ds1hc9g54k7ct8x7p3kwsq1h0000gn/T/tmp.fqWhNgGdn6/
Will match JS files for errors on files starting with https://fake.website
version: 0.0.1 service: test_datadog-ci project path:
Uploading sourcemap /var/folders/s_/ds1hc9g54k7ct8x7p3kwsq1h0000gn/T/tmp.fqWhNgGdn6/fake.js.map for JS file available at https://fake.website/fake.js
✅ Uploaded 1 files in 0.68 seconds.
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about Uploading JavaScript Source Maps][1]

[1]: https://docs.datadoghq.com/real_user_monitoring/guide/upload-javascript-source-maps/
