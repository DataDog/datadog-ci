# datadog-ci
Use Datadog from your CI.

## Usage

### Setup

You need to either have `DD_API_KEY` and `DD_APP_KEY` in your environment or pass them to the CLI.
```bash
# Environment setup
export DD_API_KEY="<DATADOG_API_KEY>"
export DD_APP_KEY="<DATADOG_APPLICATION_KEY>"

# Passing to CLI
datadog-ci --apiKey "<DATADOG_API_KEY>" --appKey "<DATADOG_APPLICATION_KEY>"
```

### API

The CLI supports the following commands:

- [synthetics](src/commands/synthetics/README.md): to run and manage synthetics tests in CI

```bash
Usage: datadog-ci [options] <command> [cmdOptions] <subCommand> [subCmdOptions]

Options:
  --appKey   [appKey]    Application Key
  --apiKey   [apiKey]    API Key
  --apiUrl   [url]       API URL (default: "https://dd.datad0g.com/api/v1")
  --files    [files]     Files to include (default: "{,!(node_modules)/**/}*.synthetics.json")
  --timeout  [timeout]   Timeout in ms (default: 2 minutes)
  --config   [file]      Path to config file
```

#### Configuration

You can use many different format of configuration file, [more info in the **rc** Github repository](https://github.com/dominictarr/rc#standards).

For instance with a JSON file `synthetics-config.json`:

```json
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "apiUrl": "https://app.datadoghq.com/api/v1",
    "files": "{,!(node_modules)/**/}*.synthetics.json",
    "global": {
        "startUrl": "{{URL}}?test_param=synthetics"
    },
    "timeout": 220000
}
```

Then run:

```bash
yarn datadog-ci --config ./synthetics-config.json synthetics run-tests
```

## Development

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
