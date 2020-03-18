# datadog-ci

Use Datadog from your CI.

## Usage

### How to install the CLI

The package is published privately under [@datadog/datadog-ci](https://www.npmjs.com/package/@datadog/datadog-ci) in the NPM registry.

Until it is made public, a NPM token is needed to access it, this can be set in the `~/.npmrc` file:

```
//registry.npmjs.org/:_authToken=<TOKEN>
```

Then, installing the package is done through NPM or Yarn:

```sh
# NPM
npm install -D @datadog/datadog-ci

# Yarn
yarn add --save-dev @datadog/datadog-ci
```

### API

The CLI supports the following commands:

- [synthetics](src/commands/synthetics/): to run synthetics tests in CI

```bash
Usage: datadog-ci <command> <subcommand> [options]

Available command:
  - synthetics
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
yarn prepack
```

## Contributing

Pull requests are welcome. First, open an issue to discuss what you would like to change. For more information, read the [Contributing Guide](CONTRIBUTING.md).

## License

[Apache License, v2.0](LICENSE)
