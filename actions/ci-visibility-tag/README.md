# CI Visibility collector

Add this JavaScript action before instrumented actions to create a shared local
recording directory and upload its contents after their post scripts finish.
The action is implemented by the dependency-free `@datadog/ci-visibility` package.
See the [SDK documentation](../../packages/ci-visibility/README.md) for installation,
examples, metadata resolution, and delivery limits.

Use `DataDog/datadog-ci/actions/ci-visibility-tag@<commit>` with a commit containing
this action, or `uses: ./actions/ci-visibility-tag` after checking out this repository.
No separate `datadog/ci-visibility-tag` release is published by this change.

| Input | Default |
| --- | --- |
| `api-key` | `DATADOG_API_KEY` or `DD_API_KEY`, read at upload time |
| `site` | `DATADOG_SITE`, `DD_SITE`, then `datadoghq.com` |
| `dry-run` | `false`; `true` retains records without sending HTTP |
| `upload-timeout-ms` | `10000` |

The action uses Node.js 24 supplied by the GitHub runner. It has no npm install
step or third-party runtime modules. To rebuild the committed `index.cjs` from the
monorepo root, run `yarn bundle:ci-visibility-action`.
