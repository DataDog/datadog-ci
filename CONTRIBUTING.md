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

#### Release Process

<details>
  <summary>Instructions</summary>

To release a new version of `datadog-ci`:

1. Create a new branch for the version upgrade.
2. Update the `package.json` version to `X.X.X`, commit the change `vX.X.X` and tag it with `git tag vX.X.X`.
   - You may refer to [Semantic Versioning](https://semver.org/#summary) to determine what level to increment.
4. Push the branch **along with the tag** with `git push --tags origin name-of-the-branch`, create a PR, and get at least one approval.
   - **Find and open** the workflow run corresponding to your tag [in this list](https://github.com/DataDog/datadog-ci/actions/workflows/publish-release.yml).
   - Copy the release notes from the summary, and paste them in the description of your PR. This ensures the feature PRs have a link to your release PR.
   - Add the `release` label to your PR.
   - See this [example PR](https://github.com/DataDog/datadog-ci/pull/1215).
5. Once you've received at least one approval, merge the PR **with the "Create a merge commit" strategy**.
   - You may notice that a **GitHub** job is waiting for an approval, and some **_GitLab_** jobs are pending: this is expected (see **step 6 and 8**). You can merge the PR when *only those jobs* are left.
   - The "Create a merge commit" strategy is required for **step 7**, and for the GitHub Release to point to an existing commit once the PR is merged.
6. The `npm-publish` job is waiting for an approval: accept it and wait for it and its downstream jobs to succeed.
7. Go to the draft GitHub Release, and publish it as **latest**.
   - There should be 3 binaries available in the release's assets.
8. Finally, go to the [_GitLab_ pipelines](https://gitlab.ddbuild.io/DataDog/datadog-ci/-/pipelines?scope=tags&status=manual), find the pipeline for your tag, and start the `build` stage to run the Docker image build jobs.
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
