## Contributing

Pull requests for bug fixes are welcome, but before submitting new features or changes to current functionality, [open an issue](https://github.com/DataDog/datadog-ci/issues/new)
and discuss your ideas or propose the changes you wish to make. After a resolution is reached, a PR can be submitted for review.

### Running command in development environment

When developing the tool, it is possible to run commands using `yarn launch`. It relies on `tsx`, so it does not require building the project for every new change.

```bash
# Install dependencies (run once)
yarn install

yarn launch synthetics run-tests --config dev/global.config.json
```

### Framework and libraries used

- [clipanion](https://github.com/arcanis/clipanion): CLI library to handle the different commands.
- [eslint](https://github.com/eslint/eslint): Linting ([.eslintrc.js](/.eslintrc.js)).
- [jest](https://github.com/facebook/jest): Tests are written in Jest.
- [volta](https://github.com/volta-cli/volta): NodeJS and yarn versioning.

### Creating a new command

Follow the [Structure](#structure) below for any commands you add. Then, don't forget the [Things to update](#things-to-update) in the project.

#### Structure

Commands are stored in the [packages/datadog-ci/src/commands](packages/datadog-ci/src/commands) folder.

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

The `index.ts` file must export classes extending the `Command` class of `clipanion`. The commands of all `packages/datadog-ci/src/commands/*/index.ts` files will then be imported and made available in the `datadog-ci` tool.

A sample `index.ts` file for a new command would be:

```typescript
import {Command} from 'clipanion'

export class HelloWorldCommand extends Command {
  public async execute() {
    this.context.stdout.write('Hello world!')
  }
}

module.exports = [HelloWorldCommand]
```

Lastly, unit tests must be created in the `__tests__/` folder. The tests can then be launched with the `yarn test` command: it finds all files with a filename ending in `.test.ts` in the repo and executes them.

#### Beta command

If your command is related to a beta product or feature, or you want to test out the command first, you can mark your command as beta.

To do so, add your command's name to the [`BETA_COMMANDS` array](https://github.com/DataDog/datadog-ci/blob/35c54e1d1e991d21461084ef2e346ca1c6bb7ea6/src/cli.ts#L8).

Users have to prefix their command line with `DD_BETA_COMMANDS_ENABLED=1` to use the command. Make sure to document this in your command's README for visibility. This should be removed once the command goes out of beta.

Optionally, you can create a pre-release for your command by following the [Pre-Release Process](#pre-release-process) instructions below.

#### Things to update

- The [Usage section in the root README](README.md#usage) must be updated to link to:
  - The new command's README.
  - And 📚 should link to the official Datadog documentation site.
  - **Note:** If your command is beta, use the [Beta commands](README.md#beta-commands) section instead.

- The command should be added under the right product in the [CODEOWNERS](.github/CODEOWNERS) file to ensure the right people are notified when a PR is opened.
  - If you are only adding a sub-command (e.g. `datadog-ci <existing-command> <new-sub-command>`), no changes are required.

- If you are adding a command for a new product, you should:
  - Create a label [here](https://github.com/DataDog/datadog-ci/issues/labels) and add it to [`pr-required-labels.yml`](.github/workflows/pr-required-labels.yml).
  - Update [`advanced-issue-labeler.yml`](.github/advanced-issue-labeler.yml).
  - Update the `changelog` configuration in [`release.yml`](.github/release.yml).

### Continuous Integration tests

The CI performs tests to avoid regressions by building the project, running unit tests and running end-to-end tests.

For the end-to-end tests (defined in `.github/workflows/ci.yml` inside the `e2e-test` job), the `datadog-ci` package is installed in a new project with a `.tgz` artifact and configured with files in the `.github/workflows/e2e` folder.
Then a suite of commands are tested to ensure they work as expected. Each command generally uses a dedicated Datadog org (e.g. `Synthetics E2E Testing Org` for Synthetics tests).

### Workflow

```bash
# Compile and watch
yarn watch

# Run the tests
yarn test

# Build code
yarn build

# Make bin executable
yarn prepack
```

### Release Process

See [RELEASING.md](RELEASING.md).
