## Contributing

Pull requests for bug fixes are welcome, but before submitting new features or changes to current functionality, [open an issue](https://github.com/DataDog/datadog-ci/issues/new)
and discuss your ideas or propose the changes you wish to make. After a resolution is reached, a PR can be submitted for review.

### Listing NPM packages

This repository is a monorepo containing multiple packages published to NPM. You can list all packages with the following command:

```sh
npm search 'maintainer:datadog keywords:datadog-ci'
```

To only list the plugins:

```sh
npm search 'maintainer:datadog keywords:datadog-ci,plugin'
```

You can also use the following datadog-ci command to get more information:

```sh
yarn launch plugin list --all
```

### Running command in development environment

When developing the tool, it is possible to run commands using `yarn launch`. It relies on `tsx`, so it does not require building the project for every new change.

```bash
# Install dependencies (run once)
yarn install

yarn launch <scope> <command> ...
```

### Framework and libraries used

- [clipanion](https://github.com/arcanis/clipanion): CLI library to handle the different commands.
- [eslint](https://github.com/eslint/eslint): Linting ([.eslintrc.js](/.eslintrc.js)).
- [jest](https://github.com/facebook/jest): Tests are written in Jest.
- [volta](https://github.com/volta-cli/volta): Node.js and yarn versioning.

### Creating a new command

Follow the [Structure](#structure) below for any commands you add. Then, don't forget the [Things to update](#things-to-update) in the project.

#### Structure

The repository is a monorepo:

- **`packages/base`** (`@datadog/datadog-ci-base`): Holds command definitions (descriptions, paths, arguments), but **not their implementation**.
  - As an **exception**, some commands that are core to datadog-ci with multiple scopes depending on each other are implemented in the base package.
- **`packages/plugin-<scope>`**: Holds command implementations for a specific scope.
  - A plugin can either be **built-in** if it's lightweight, or **separately installable** if it pulls many dependencies.
- **`packages/datadog-ci`**: Thin CLI entrypoint that imports commands from the base package, and **lists built-in plugins** as `dependencies`.

The skeleton of **any command** is defined in the base package:

```bash
packages/base/src/commands/
└── <scope>/
    ├── cli.ts          # Exports a `commands` array (auto-generated)
    └── <command>.ts    # Definition of your command (should extend `BaseCommand`)
```

Your new command can be put:
- In an existing scope
- In a new scope
  - By default, all new scopes should be plugins.
    - Then you should **choose** whether you want your plugin to be built-in or separately installable.
  - Exceptionally, it's possible to put your command in the base package. But you must have a good reason for doing so.

To add a new command to a scope, create `packages/base/src/commands/<scope>/<command>.ts`:

```typescript
import {BaseCommand} from '@datadog/datadog-ci-base'
import {Command, Option} from 'clipanion'

export class FooBarCommand extends BaseCommand {
  public static paths = [['foo', 'bar']]

  public static usage = Command.Usage({
    description: 'Description of the command.',
  })

  public myOption = Option.String('--my-option', {
    description: 'Description of the option.',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
```

Then, create a new plugin with `yarn plugin:create <scope>`.

Inside the plugin, create `packages/plugin-<scope>/src/commands/<command>.ts`:

```typescript
import {FooBarCommand} from '@datadog/datadog-ci-base/commands/foo/bar'

export class PluginCommand extends FooBarCommand {

  // Implement your command's logic here
  public async execute() {
    console.log('Hello world!')
    return 0
  }
}
```

Unit tests in a given folder go in a `__tests__/` subfolder. Run them with `yarn test`; Jest picks up all `*.test.ts` files in the repo.

#### Beta command

If your command is related to a beta product or feature, or you want to test out the command first, you can mark your command as beta.

To do so, add your command's scope to the [`BETA_COMMANDS` set](packages/datadog-ci/src/cli.ts) in `packages/datadog-ci/src/cli.ts`.

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
