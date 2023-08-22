# Datadog CI

[![NPM Version](https://img.shields.io/npm/v/@datadog/datadog-ci)](https://www.npmjs.com/package/@datadog/datadog-ci) ![Continuous Integration](https://github.com/DataDog/datadog-ci/workflows/Continuous%20Integration/badge.svg) [![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0) ![NodeJS Version](https://img.shields.io/badge/Node.js-14+-green)

Execute commands with Datadog from within your Continuous Integration/Continuous Deployment scripts to perform end-to-end tests of your application before applying your changes or deploying. `datadog-ci` allows you to run Continuous Testing tests and wait for the results.

## How to install the CLI

The package is under [@datadog/datadog-ci](https://www.npmjs.com/package/@datadog/datadog-ci) and can be installed through NPM or Yarn:

```sh
# NPM
npm install --save-dev @datadog/datadog-ci

# Yarn
yarn add --dev @datadog/datadog-ci
```

If you need `datadog-ci` as a CLI tool instead of a package, you can run it with [`npx`](https://www.npmjs.com/package/npx) or install it globally:

```sh
# npx
npx @datadog/datadog-ci [command]

# NPM install globally
npm install -g @datadog/datadog-ci

# Yarn v1 add globally
yarn global add @datadog/datadog-ci
```

For more ways to install the CLI, see [this section](#more-ways-to-install-the-cli).

## Usage

```bash
Usage: datadog-ci <command> <subcommand> [options]
```

The following values are available for each `<command>`. See the corresponding documentation for more details:

- `dsyms`: [iOS dSYM Files](src/commands/dsyms/)
- `flutter-symbols`: [Flutter Symbols](src/commands/flutter-symbols/)
- `git-metadata`: [Git metadata](src/commands/git-metadata)
- `junit`: [JUnit XML](src/commands/junit)
- `lambda`: [Lambda](src/commands/lambda)
- `metric`: [Metric](src/commands/metric)
- `react-native`: [React Native sourcemaps](src/commands/react-native/)
- `sourcemaps`: [Browser sourcemaps](src/commands/sourcemaps/)
- `stepfunctions`: [Step Functions](src/commands/stepfunctions)
- `synthetics`: [Continuous Testing](src/commands/synthetics/)
- `tag`: [Tag](src/commands/tag)
- `trace`: [Trace](src/commands/trace)

## Contributing

Pull requests for bug fixes are welcome, but before submitting new features or changes to current functionality, [open an issue](https://github.com/DataDog/datadog-ci/issues/new)
and discuss your ideas or propose the changes you wish to make. After a resolution is reached, a PR can be submitted for review.

### Running command in development environment

When developing the tool, it is possible to run commands using `yarn launch`. It relies on `ts-node`, so does not require building the project for every new change.

```bash
yarn launch synthetics run-tests --config dev/global.config.json
```

### Framework and libraries used

- [clipanion](https://github.com/arcanis/clipanion): CLI library to handle the different commands.
- [eslint](https://github.com/eslint/eslint): Linting ([.eslintrc.js](/.eslintrc.js)).
- [jest](https://github.com/facebook/jest): Tests are written in Jest.
- [volta](https://github.com/volta-cli/volta): NodeJS and yarn versioning.

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
import {Command} from 'clipanion'

export class HelloWorldCommand extends Command {
  public async execute() {
    this.context.stdout.write('Hello world!')
  }
}

module.exports = [HelloWorldCommand]
```

Lastly, test files must be created in the `__tests__/` folder. `jest` is used to run the tests and a CI has been set using GitHub Actions to ensure all tests are passing when merging a Pull Request.

The tests can then be launched through the `yarn test` command, it will find all files with a filename ending in `.test.ts` in the repo and execute them.

### Continuous Integration tests

The CI performs tests to avoid regressions by building the project, running unit tests and running one end-to-end test.

The end-to-end test installs the package in a new project, configures it by using files in the `.github/workflows/e2e` folder, and runs a `synthetics run-tests` command in a Datadog org (such as `Synthetics E2E Testing Org`) to verify the command is able to perform a test.

The Synthetic tests that are run include a browser test (with a test ID of `neg-qw9-eut`) and an API test (with a test ID of `v5u-56k-hgk`). Both tests load a page which outputs the headers of the request and verifies the `X-Fake-Header` header is present. This header is configured as an override in the `.github/workflows/e2e/test.synthetics.json` file. The API and application keys used by the command are stored in GitHub Secrets named `datadog_api_key` and `datadog_app_key`.

The goal of this test is to verify the command is able to run tests and wait for their results as expected as well as handling configuration overrides.

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

#### Release Process

<details>
  <summary>Instructions</summary>

To release a new version of `datadog-ci`:

1. Create a new branch for the version upgrade.
2. Update the `package.json` version to `X.X.X`, commit the change `vX.X.X` and tag it with `git tag vX.X.X`.
   - You may refer to [Semantic Versioning](https://semver.org/#summary) to determine what level to increment.
4. Push the branch **along with the tag** with `git push --tags origin name-of-the-branch`, create a PR, and get at least one approval.
   - [Create a draft GitHub Release (prefilled link)](https://github.com/DataDog/datadog-ci/releases/new?title=%3Csame-as-tag%3E&body=%3C!--%20Use%20the%20%22Generate%20release%20notes%22%20button%20at%20the%20top%20right,%20then%20categorize%20the%20changes%20--%3E) and **save it as a draft**.
   - Please categorize the changes by product or "Documentation" / "Dependencies" / "Chores". You can find commands grouped by product in the [`.github/CODEOWNERS`](https://github.com/DataDog/datadog-ci/blob/master/.github/CODEOWNERS) file.
   - Copy the categorized release notes, and paste them in the description of your PR. This ensures the feature PRs have a link to your release PR.
   - See this [example PR](https://github.com/DataDog/datadog-ci/pull/1047).
5. Once you've received at least one approval, merge the PR **with the "Create a merge commit" strategy**.
   - You may notice that some **_GitLab_** jobs are pending, this is expected (see **step 7**). You can merge the PR when *only those jobs* are left.
   - The "Create a merge commit" strategy is required for **step 7**, and for the GitHub Release to point to an existing commit once the PR is merged.
6. Go back to your draft GitHub Release, and publish it.
7. Once the release is published, [this GitHub Workflow](https://github.com/DataDog/datadog-ci/actions/workflows/release.yml) publishes the NPM package and adds binaries to the release's assets. Wait for it to succeed.
8. When the NPM package is published, go to the [_GitLab_ pipelines](https://gitlab.ddbuild.io/DataDog/datadog-ci/-/pipelines?scope=tags&status=manual), find the pipeline for your tag, and start the `build` stage to run the Docker image build jobs.
   - Make sure all the jobs and downstream jobs succeed.

Thanks for creating a release! 🎉

</details>

#### Pre-Release Process

<details>
  <summary>Instructions</summary>

To create a pre-release or releasing in a different channel:

1. Create a new branch for the channel you want to release to (`alpha`, `beta`, and more).
2. Create a PR for your feature branch with the channel branch as a base.
3. Pick a version following this format: `<version>-<channel>`. For example, `0.10.9-alpha`, `1-beta`, and more.
4. Update the `version` field in `package.json`.
5. Once you've received at least one approval, merge the Pull Request **with the "Create a merge commit" strategy**.
6. Create a [GitHub Release](https://github.com/DataDog/datadog-ci/releases/new?target=alpha&tag=0.10.9-alpha&prerelease=1&title=Alpha+prerelease):
   - Target the channel branch.
   - Pick a tag based on your version `<version>-<channel>`.
   - Check the `This is a pre-release` checkbox.
7. Publish the release and an action publishes it on npm.

<img src="./assets/pre-release.png" width="500"/>

</details>

## More ways to install the CLI

### Standalone binary (**beta**)

If installing NodeJS in the CI is an issue, standalone binaries are provided with [releases](https://github.com/DataDog/datadog-ci/releases). _linux-x64_, _darwin-x64_ (macOS), and _win-x64_ (Windows) are supported. **These standalone binaries are in beta and their stability is not guaranteed**.

To install:

#### Linux

```sh
curl -L --fail "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_linux-x64" --output "/usr/local/bin/datadog-ci" && chmod +x /usr/local/bin/datadog-ci
```

#### MacOS

```sh
curl -L --fail "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_darwin-x64" --output "/usr/local/bin/datadog-ci" && chmod +x /usr/local/bin/datadog-ci
```

#### Windows

```sh
Invoke-WebRequest -Uri "https://github.com/DataDog/datadog-ci/releases/latest/download/datadog-ci_win-x64.exe" -OutFile "datadog-ci.exe"
```

Then, you can run `datadog-ci` commands normally:

```sh
datadog-ci version
```

### Container image

To run `datadog-ci` from a container, you can use the `datadog/ci` image available in [Dockerhub](https://hub.docker.com/r/datadog/ci) as well as the public [Amazon ECR](https://gallery.ecr.aws/datadog/ci) and [Google GC](https://console.cloud.google.com/gcr/images/datadoghq/global/ci) registries.

```
docker pull datadog/ci
```

This example demonstrates how to run a command using the container and passing in the API and APP keys:

```
export DD_API_KEY=$(cat /secret/dd_api_key)
export DD_APP_KEY=$(cat /secret/dd_app_key)
docker run --rm -it -v $(pwd):/w -e DD_API_KEY -e DD_APP_KEY datadog/ci synthetics run-tests -p pub-lic-id1
```

#### Building your own container image

You can build an image using the provided [Dockerfile](https://github.com/DataDog/datadog-ci/blob/master/container/Dockerfile):

```sh
cd container
docker build --tag datadog-ci .
```

Optionally, you can use the `VERSION` build argument to build an image for a specific version:

```sh
docker build --build-arg "VERSION=v1.14" --t datadog-ci .
```

## License

[Apache License, v2.0](LICENSE)
