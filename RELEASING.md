# Release Process

To release a new version of `datadog-ci`:

1. Create a new branch for the version upgrade.
2. Update the `package.json` version to `X.X.X`, commit the change `vX.X.X` and tag it with `git tag vX.X.X`.
   - You may refer to [Semantic Versioning](https://semver.org/#summary) to determine what level to increment.
3. Push the branch **along with the tag** with `git push --tags origin name-of-the-branch`, create a PR, and get at least one approval.
   - **Find and open** the workflow run corresponding to your tag [in this list](https://github.com/DataDog/datadog-ci/actions/workflows/publish-release.yml).
   - Copy the release notes from the summary, and paste them in the description of your PR. This ensures the feature PRs have a link to your release PR.
   - Add the `release` label to your PR.
   - See this [example PR](https://github.com/DataDog/datadog-ci/pull/1215).
4. Once you've received at least one approval, merge the PR **with the "Create a merge commit" strategy**.
   - You may notice that a **GitHub** job is waiting for an approval, and some **_GitLab_** jobs are pending: this is expected (see **step 6 and 8**). You can merge the PR when *only those jobs* are left.
   - The "Create a merge commit" strategy is required for **step 7**, and for the GitHub Release to point to an existing commit once the PR is merged.
5. The `npm-publish` job is waiting for an approval from a datadog-ci maintainer: ask for approval and wait for it and its downstream jobs to succeed.
6. Go to the draft GitHub Release, and publish it as **latest**.
   - There should be 5 binaries available in the release's assets.
7. Finally, go to the [_GitLab_ pipelines](https://gitlab.ddbuild.io/DataDog/datadog-ci/-/pipelines?scope=tags&status=manual), find the pipeline for your tag, and start the `build` stage to run the Docker image build jobs.
   - Make sure all the jobs and downstream jobs succeed.

Thanks for creating a release! 🎉

## Overwriting a release candidate

Some PRs were just merged and you want to release them, but you already started the release process? Follow these instructions.

> [!IMPORTANT]  
> If you went through this section, please notify the reviewer so they can ensure everything is correct.

To overwrite a release candidate:

- Cancel the ["Publish package on NPM" workflow](https://github.com/DataDog/datadog-ci/actions/workflows/publish-release.yml) to make sure we don't approve it by mistake.
- Remove the [draft GitHub Release here](https://github.com/DataDog/datadog-ci/releases).
- Force push your PR:
  - Rebase your PR with `git rebase master` (make sure you pulled `master`).
  - Looking at `git log`, your `vX.X.X` bump commit should now be right _after_ the latest commit on `master`.
  - Overwrite the tag to point to your new commit with `git tag --force vX.X.X`.
  - Force push with `git push --force` and `git push --tags --force`.
- Update your PR description with the new release notes.
- Continue from step 4 of the Release Process.

# Pre-Release Process

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
