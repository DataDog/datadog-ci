# CI Visibility JavaScript API

Record custom spans, tags, and measures from JavaScript in GitHub Actions without
starting a CLI process for each call. Calls record in memory; users explicitly
call `await flush()` to upload.

This package is not yet released. It requires Node.js 20 or later and has no
external runtime dependencies. **Only GitHub Actions is supported at the moment.**

## Usage

Once published, install `@datadog/ci-visibility` and import its `/github` entry point
in your JavaScript action or Node.js CI script. For a custom action, bundle it with
your code following GitHub's
[JavaScript action guide](https://docs.github.com/en/actions/tutorials/create-actions/create-a-javascript-action).
The application being built can use any language.

```js
import {span, setTags, setMeasure, flush} from '@datadog/ci-visibility/github'
import {compile, runTests} from './build.js'

try {
  setTags(
    {'build.mode': 'release', 'workflow.version': process.env.WORKFLOW_VERSION},
    {levels: ['pipeline', 'job', 'step'], steps: 'all'}
  )

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
- `startSpan(name, tags?)` starts a manual span. Call `end({exitCode, error, tags,
  measures})` to finish it; the options are optional. `end()` returns the duration
  in milliseconds and queues the span only once. End manual spans before flushing.
- `setTags(tags, {levels})` annotates existing pipeline, job, or current main-step
  events. The default level is `job`; tags do not inherit between levels.
- `setMeasure(name, value, {level})` adds a numerical annotation, defaulting to `job`.
- Add `steps: 'all'` with the `step` level to tag all declared main steps of the
  current job.

Supply workflow, action, tool, and cache tags through these methods. Span tags can
be supplied at creation, through the span's `setTags()`, or when ending the span.
Repeated tag keys use the last supplied value.

For application code that returns an exit code, or has separate start/end callbacks:

```js
import {startSpan, flush} from '@datadog/ci-visibility/github'
import {compile} from './build.js'

const current = startSpan('Compile', {'compiler.version': process.env.COMPILER_VERSION})
try {
  const result = await compile() // Application logic.
  current.end({exitCode: result.exitCode, measures: {'output.bytes': result.bytes}})
} catch (error) {
  current.end({error})
  throw error
} finally {
  await flush()
}
```

In post scripts, use custom spans or job/pipeline annotations. Current-step
annotations would otherwise target the action's main step.

## Configuration

Set `DD_API_KEY` or `DATADOG_API_KEY` before calling `flush()`. Optionally set
`DD_SITE` or `DATADOG_SITE`; the default is `datadoghq.com`. GitHub run, job, step,
and Git metadata are discovered automatically.

Set `DD_CI_VISIBILITY_ENABLED=false` to disable reporting. Wrapped application code
still executes.

`DD_CI_VISIBILITY_WARNING_LEVEL` selects the console method for SDK diagnostics:
`warn` (default), `info`, or `debug`. Set it to `off` to silence default logging.
Values are case-insensitive; unrecognized values use `warn`. This only changes
logging; recording and uploads still run. An `onWarning` callback supplied to
`createRecorder()` or `flush()` takes precedence over this setting.

Set it through the workflow, job, or step environment, for example:

```yaml
env:
  DD_CI_VISIBILITY_WARNING_LEVEL: info
```

Uploads use at most four concurrent requests, a 4-second request deadline, and a
10-second overall budget. HTTP 429/5xx responses receive bounded retries;
transport failures stop the remaining queue. Override the deadlines with
`flush({requestTimeoutMs, timeoutMs})`. Proxy configuration is not supported.
