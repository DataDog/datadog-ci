# CI Visibility JavaScript API

Record custom spans, tags, and measures from JavaScript in GitHub Actions without
starting a CLI process for each call. Calls record in memory; users explicitly
call `await flush()` to upload.

This package is not yet released. It requires Node.js 20 or later and has no
external runtime dependencies.

## Usage

Once published, install `@datadog/ci-visibility` in your JavaScript action or Node.js
CI script. For a custom action, bundle it with your code following GitHub's
[JavaScript action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).
The application being built can use any language.

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

Each action's main script, post script, or instrumented child process owns its own
queue and must call `flush()`. There is no automatic upload at process exit.

`flush()` returns `{sent, failed, skipped}` request counts and drains the queue.
Reporting errors do not replace application results or errors. Failed uploads
are discarded rather than retried by a later flush.

## Spans, tags, and measures

- `span(name, callback)` records duration and errors, preserves the callback's
  result, and rethrows its original error. The callback handle annotates that
  custom span only.
- `setTags(tags, {levels})` annotates existing pipeline, job, or current main-step
  events. The default level is `job`; tags do not inherit between levels.
- `setMeasure(name, value, {level})` adds a numerical annotation, defaulting to `job`.
- Add `steps: 'all'` with the `step` level to tag all declared main steps of the
  current job.

In post scripts, use custom spans or job/pipeline annotations. Current-step
annotations would otherwise target the action's main step.

## Configuration

Set `DD_API_KEY` or `DATADOG_API_KEY` before calling `flush()`. Optionally set
`DD_SITE` or `DATADOG_SITE`; the default is `datadoghq.com`. GitHub run, job, step,
and Git metadata are discovered automatically.

Uploads use at most four concurrent requests, a 4-second request deadline, and a
10-second overall budget. HTTP 429/5xx responses receive bounded retries;
transport failures stop the remaining queue. Override the deadlines with
`flush({requestTimeoutMs, timeoutMs})`. Proxy configuration is not supported.

## Local development

From the monorepo root:

```sh
yarn install
yarn build
yarn test packages/ci-visibility --runInBand
yarn workspace @datadog/ci-visibility pack --out /tmp/ci-visibility.tgz
```

Tests use mocked or local HTTP endpoints and do not call Datadog.
