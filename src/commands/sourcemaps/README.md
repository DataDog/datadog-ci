# Sourcemaps command

Upload JS sourcemaps to Datadog to un-minify your errors.

## Usage

### Setup

You need to have `DATADOG_API_KEY` in your environment.

```bash
# Environment setup
export DATADOG_API_KEY="<API KEY>"
```

It is possible to configure the tool to use Datadog EU by defining the `DATADOG_SITE` environment variable to `datadoghq.eu`. By defaut the requests are sent to Datadog US. In order to send the usage metrics to the correct datacenter, the `DATADOG_API_HOST` must also be set if another instance of Datadog is used. For example, for Datadog EU, it should be set to `api.datadoghq.eu`.

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

* `--minified-path-prefix` (required) is the URL or absolute path prefix that will be matched against the URL we got the error from. It must be set to the actual url or the absolute path exposed on the server (and used by browsers to retrieve the minified file). 
When un-minifying the stack traces, the URL of the static files will be matched against the concatenation of this prefix and the relative path to the folder you're uploading sourcemaps from of the JS file.
Full URLs matching will be prioritized over absolute paths matches.
The protocol will be ignored when matching using full URLs. The protocol can be explicitly omitted, for example: `//static.datadog.com/js`.  
Absolute paths must always begin with a leading slash. Simply specify `/` if the content is expected to be at the root directory on the server.

In addition, some optional parameters are available:

* `--concurrency` (default: `20`): number of concurrent upload to the API.
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.
* `--disable-git` (default: false): Presence of flag prevents the command from sending any repository related data to Datadog (hash, remote URL and the correct paths within the repository of the source paths referenced in the sourcemap).
* `--repository-url` (default: empty): overrides the repository remote with a custom URL. For example: https://github.com/my-company/my-project
* `--project-path` (default: empty): the path of the project where the sourcemaps were built. This will be stripped off from sources paths referenced in the sourcemap so they can be properly matched against tracked files paths.

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
