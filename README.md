# datadog-ci

Use Datadog from your CI.

## Usage

### API

The CLI supports the following commands:

- [synthetics](src/commands/synthetics/): to run synthetics tests in CI

```bash
Usage: datadog-ci <command> <subcommand> [options]

Available command:
  - synthetics
```

#### Configuration

You can use many different format of configuration file, [more info in the **rc** Github repository](https://github.com/dominictarr/rc#standards).

Configuration options can be overriden through environment variables but not via CLI flags.

For instance with a JSON file `.datadogcirc`:

```json
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "datadogHost": "https://app.datadoghq.com/api/v1",
    "synthetics": {
      "files": "{,!(node_modules)/**/}*.synthetics.json",
      "global": {
          "allowInsecureCertificates": true,
          "basicAuth": {
            "username": "fakeusername",
            "password": "fakepassword"
          },
          "deviceIds": ["laptop_large", "mobile_small"],
          "followRedirects": true,
          "headers": {
            "User-Agent": "fake-user-agent"
          },
          "locations": ["aws:us-east-1", "pl:fake_private_location"],
          "startUrl": "{{URL}}?test_param=synthetics",
          "variables": {
            "ADMIN_USERNAME": "adminuser",
            "ADMIN_PASSWORD": "adminpassword",
          }
      },
      "timeout": 220000
    }
}
```

Then run:

```bash
yarn datadog-ci synthetics run-tests
```

## Development

### Repository structure

This tool uses [clipanion](https://github.com/arcanis/clipanion) to handle the different commands. Each command is described in its directory in the `src/commands/` folder. It must contain an `index.ts` file exporting the subcommands available to the user. 

The tests are written using [jest](https://github.com/facebook/jest) and stored in the `__tests__` folders close to the sources under test.

### Workflow

```bash
# Compile and watch
yarn watch

# Run the tests
yarn jest

# Build code
yarn build

# Format code
yarn format

# Make bin executable
yarn prepare
```