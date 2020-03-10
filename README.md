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

Configuration is done via a json file, by default the tool load `datadog-ci.json` which can be overriden through the `--config` argument.

The configuration file structure is the following:

```json
{
    "apiKey": "<DATADOG_API_KEY>",
    "appKey": "<DATADOG_APPLICATION_KEY>",
    "datadogHost": "https://app.datadoghq.com/api/v1",
    "synthetics": {
      ...
    }
}
```

The `synthetics` sub-object structure is defined by the [synthetics](src/commands/synthetics) command.

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

## Contributing

Pull requests are welcome. First, open an issue to discuss what you would like to change. For more information, read the [Contributing Guide](CONTRIBUTING.md).

## License

[Apache License, v2.0](LICENSE)
