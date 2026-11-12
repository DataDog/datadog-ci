# CI Visibility JavaScript API

Record custom spans, tags, and numerical measures from JavaScript GitHub actions
without starting a Datadog CLI process for each annotation. Recording makes no HTTP
requests. Each process buffers its annotations in memory and uploads them when
you call `flush()` at completion.

This new package is not yet released. It supports Node.js 20 and later, GitHub
Actions, and has no external runtime dependencies. It does not install the CLI or
`@datadog/datadog-ci-base`.

## Install in a JavaScript action

Once published, install `@datadog/ci-visibility` in the action's own package and
bundle it with the action entrypoints. See GitHub's
[JavaScript action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).
The application being built can use any language. GitHub provides the Node runtime
declared by the action, and the consuming workflow does not need to install the SDK.

```js
import {span, setTags, setMeasure, flush} from '@datadog/ci-visibility'
import {compile, runTests} from './build.js'

try {
  setTags({'build.mode': 'release'}, {levels: ['pipeline', 'job', 'step']})

  await span('Compile', async current => {
    const result = await compile() // Application logic.
    current.setTags({'compiler.target': result.target})
    current.setMeasure('output.bytes', result.bytes)
  })

  const result = await span('Run tests', runTests)
  setMeasure('test.count', result.count, {level: 'job'})
} finally {
  await flush()
}
```

Every process owns an in-memory queue. Main scripts, post scripts, and instrumented
child processes each call `flush()` before completing.
It uploads the current queue and returns `{sent, failed, skipped}` HTTP-request
counts. A subsequent flush does not resend that queue. Failed uploads
are discarded, and reporting errors do not replace application results or errors.

For an existing Node.js project, the same API can be imported by a CI script run
directly in a workflow step, using the project's normal dependency installation.

## Annotation scope

- `span(name, callback)` preserves the callback's return value and original error.
  The callback handle's `setTags` and `setMeasure` annotate that custom span only.
- `setTags(tags, {levels})` targets existing pipeline, job, or current step events.
  The default level is `job`. Tags do not inherit between levels.
- Add `steps: 'all'` with the `step` level to annotate every declared main step of
  the current job. This does not annotate other jobs or native cleanup steps.
- `setMeasure(name, value, {level})` targets one native level, defaulting to `job`.
- Native tag patches and measure patches are coalesced separately for identical
  targets. Custom spans retain their own annotations.

For example, explicitly apply a shared annotation across the current job:

```js
setTags({'build.mode': 'release'}, {
  levels: ['pipeline', 'job', 'step'],
  steps: 'all',
})
```

In an action's post script, set `process.env.DD_CI_PHASE = 'post'` before recording
to suppress automatic current-step annotations: runner logs identify the main
step rather than a distinct native post step. Custom spans and job/pipeline
annotations still work. All-step annotations always target declared main steps.

## Metadata and upload behavior

Repository, commit, branch/tag, run, attempt, and pull-request data come from the
GitHub environment and event JSON. Job display name, check-run ID, and step index
are resolved from worker logs, cached per recorder, with explicit overrides through
`DD_GITHUB_JOB_NAME`, `JOB_CHECK_RUN_ID`, and `DD_GITHUB_STEP_INDEX`. Log discovery
supports runner installation paths derived from `RUNNER_TEMP` and versioned
diagnostic directories. An available orchestration ID selects the matching log.
The step lookup accounts for the extra runner setup step created by a job-started
hook. These runner internals may change; explicit overrides remain available.

Only selected metadata is recorded, never full worker logs. The SDK honors
`DD_GIT_REPOSITORY_URL`, `DD_GIT_COMMIT_SHA`, `DD_GIT_BRANCH`, and `DD_GIT_TAG`.
It does not run Git or discover commit author, committer, or message details.
It preserves the current custom-span intake's pipeline ID contract, with attempt
information in the correlation environment. This package does not change backend
tag enrichment or add pipeline-wide tag inheritance.

Uploads use existing Datadog intakes, with at most four requests in flight,
4-second request deadlines, a 10-second overall budget, and bounded retries for
HTTP 429/5xx. Transport failures stop the remaining queue. A single upload phase
still sends multiple HTTP requests. Override deadlines with `requestTimeoutMs`
and `timeoutMs`. The built-in transport does not implement proxy configuration.

Credentials default to `DATADOG_API_KEY` or `DD_API_KEY`; site defaults to
`DATADOG_SITE`, `DD_SITE`, then `datadoghq.com`. Set `DD_CI_VISIBILITY=false` to
disable recording. Outside GitHub Actions, wrappers execute application code and
skip recording. Forced termination or runner loss can prevent final uploading.

## Local development

From the monorepo root:

```sh
yarn install
yarn build
yarn test packages/ci-visibility --runInBand
yarn workspace @datadog/ci-visibility pack --out /tmp/ci-visibility.tgz
```

Tests use generic fixtures and mocked or local HTTP endpoints. They do not call
Datadog.
