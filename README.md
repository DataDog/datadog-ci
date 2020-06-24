# Datadog CI

![Continuous Integration](https://github.com/DataDog/datadog-ci/workflows/Continuous%20Integration/badge.svg) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

Execute commands with Datadog from within your Continuous Integration/Continuous Deployment scripts. A good way to perform end to end tests of your application before applying you changes or deploying. It currently features running synthetics tests and waiting for the results.

## How to install the CLI

The package is published privately under [@datadog/datadog-ci](https://www.npmjs.com/package/@datadog/datadog-ci) in the NPM registry.

Until it is made public, a NPM token is needed to access it, this can be set in the `~/.npmrc` file:

```
registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=<TOKEN>
```

If using Yarn v2, it is possible to scope the token to the `@datadog` scope in the `.yarnrc` file as described [in the documentation](https://yarnpkg.com/configuration/yarnrc#npmScopes):

```yaml
npmScopes:
  datadog:
    npmRegistryServer: "https://registry.npmjs.org"
    npmAuthToken: "ffffffff-ffff-ffff-ffff-ffffffffffff"
```

Then, installing the package is done through NPM or Yarn:

```sh
# NPM
npm install --save-dev @datadog/datadog-ci

# Yarn
yarn add --dev @datadog/datadog-ci
```

## Usage

```bash
Usage: datadog-ci <command> <subcommand> [options]

Available command:
  - lambda
  - sourcemaps
  - synthetics
```

Each command allows interacting with a product of the Datadog platform. The commands are defined in the [src/commands](/src/commands) folder.

Further documentation for each command can be found in its folder, ie:

- [lambda](src/commands/lambda)
- [sourcemaps](src/commands/sourcemaps/)
- [synthetics](src/commands/synthetics/)


## Contributing

Pull requests for bug fixes are welcome, but before submitting new features or changes to current functionality [open an issue](https://github.com/DataDog/datadog-ci/issues/new)
and discuss your ideas or propose the changes you wish to make. After a resolution is reached a PR can be submitted for review.

### Running command in development environment

When developing the tool it is possible to run commands using `yarn launch`. It relies on `ts-node` so does not need building the project for every new change.

```bash
yarn launch synthetics run-tests --config dev/global.config.json
```

### Framework and libraries used

This tool uses [clipanion](https://github.com/arcanis/clipanion) to handle the different commands.

The tests are written using [jest](https://github.com/facebook/jest).

The coding style is checked with [tslint](https://github.com/palantir/tslint) and the configuration can be found in the [tslint.json](/tslint.json) file.

### Repository structure

Commands are stored in the [src/commands](src/commands) folder. 

The skeleton of a command is composed of a README, an `index.ts` and a folder for the tests.

```bash
src/
└── commands/
    └── fakeCommand/
         ├── __tests__/
         │   └── index.test.ts
         ├── README.md
         └── index.ts
```

Documentation of the command must be placed in the README.md file, the [current README](/README.md) must be updated to link to the new command README.

The `index.ts` file must export classes extending the `Command` class of `clipanion`. The commands of all `src/commands/*/index.ts` files will then be imported and made available in the `datadog-ci` tool.

A sample `index.ts` file for a new command would be:

```typescript
import { Command } from 'clipanion';

export class HelloWorldCommand extends Command {
  public async execute () {
    this.context.stdout.write('Hello world!');
  }
}

module.exports = [
  HelloWorldCommand,
];
```

Lastly, test files must be created in the `__tests__/` folder. `jest` is used to run the tests and a CI has been set using Github Actions to ensure all tests are passing when merging a Pull Request.

The tests can then be launched through the `yarn test` command, it will find all files with a filename ending in `.test.ts` in the repo and execute them.

### Continuous Integration tests

The CI performs tests to avoid regressions by building the project, running unit tests and running one end-to-end test.

The end-to-end test installs the package in a new project, configures it (using files in the `.github/workflows/e2e` folder) and runs a `synthetics run-tests` command in a Datadog Org (`Synthetics E2E Testing Org`) to verify the command is able to perform a test.

The synthetics tests ran are a browser test (id `neg-qw9-eut`) and an API test (id `v5u-56k-hgk`), both loading a page which outputs the headers of the request and verifying the `X-Fake-Header` header is present. This header is configured as an override in the `.github/workflows/e2e/test.synthetics.json` file. The API and Application keys used by the command are stored in Github Secrets named `datadog_api_key` and `datadog_app_key`.

The goal of this test is to verify the command is able to run tests and wait for their results as expected as well as handling configuration overrides.

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

## License

[Apache License, v2.0](LICENSE)
