# dSYMs command

Upload dSYM files to Datadog to symbolicate your crash reports.

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

This command will upload all dSYM files in the given directory.
If your app has `BITCODE` enabled, more info in **Bitcode** section.

To upload the dSYM files in your Derived Path, this command should be run:

```bash
datadog-ci dsyms upload ~/Library/Developer/Xcode/DerivedData/
```

In addition, some optional parameters are available:

* `--concurrency` (default: `20`): number of concurrent upload to the API.
* `--dry-run` (default: `false`): it will run the command without the final step of upload. All other checks are performed.

#### Bitcode

With bitcode enabled, you should download your app's dSYM files from [App Store Connect](https://appstoreconnect.apple.com/).
They come in the form of a zip file, named `appDsyms.zip`. In that case, you can run `datadog-ci` by pointing to the zip file.

```bash
datadog-ci dsyms upload ~/Downloads/appDsyms.zip
```
### End-to-end testing process

To verify this command works as expected, you can trigger a test run and verify it returns 0:

```bash
export DATADOG_API_KEY='<API key>'

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
