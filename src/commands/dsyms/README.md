# dSYMs command

Upload dSYM files to Datadog to symbolicate your crash reports.

**This command runs only in macOS.**

## Usage

### Environment variables

- `DATADOG_API_KEY` or `DD_API_KEY` (**required**): API key used to authenticate the requests. For more information about getting a Datadog API key, see the [API key documentation][2].
- `DATADOG_SITE` or `DD_SITE`: Set the [Datadog site][3]. The default is `datadoghq.com`.

To override the base URL for the intake endpoint, define the `DATADOG_SOURCEMAP_INTAKE_URL` environment variable.

### Commands

#### `upload`

This command will upload all dSYM files in the given directory.
If your app has `BITCODE` enabled, more info in **Bitcode** section.

To upload the dSYM files in your Derived Path, this command should be run:

```bash
datadog-ci dsyms upload ~/Library/Developer/Xcode/DerivedData/
```

In addition, some optional parameters are available:

* `--max-concurrency` (default: `20`): number of concurrent upload to the API.
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

// at this point, build any project in Xcode so that it produces dSYM files in Derived Data path
// assuming your Derived Data path is ~/Library/Developer/Xcode/DerivedData/

yarn launch dsyms upload ~/Library/Developer/Xcode/DerivedData/
```

Successful output should look like this:

```bash
Starting upload with concurrency 20. 
Will look for dSYMs in /Users/mert.buran/Library/Developer/Xcode/DerivedData
Uploading dSYM with 00000-11111-00000-11111 from /path/to/dsym/file1.dSYM
Uploading dSYM with 00000-22222-00000-22222 from /path/to/dsym/file2.dSYM
Uploading dSYM with 00000-33333-00000-33333 from /path/to/dsym/file3.dSYM
...

Command summary:
✅ Uploaded 5 dSYMs in 8.281 seconds.
✨  Done in 10.71s.
```

## Further reading

Additional helpful documentation, links, and articles:

- [Learn about iOS Crash Reporting and Error Tracking][1]

[1]: https://docs.datadoghq.com/real_user_monitoring/error_tracking/ios/
[2]: https://docs.datadoghq.com/account_management/api-app-keys/#api-keys
[3]: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site
