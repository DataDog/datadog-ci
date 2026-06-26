import {spawnSync} from 'child_process'

import {cliVersion} from '../cli'

// Integration-style guard for the bug class this addresses: the auto version banner
// must never land on stdout, or it corrupts captured/piped output like
// `VAR=$(datadog-ci trace -- cmd)`. The banner is emitted in cli.ts under
// `require.main === module`, which in-process `cli.run()` tests don't exercise — so we
// spawn the real entry point and read stdout/stderr as separate streams (no shell, to
// avoid redirection quirks like zsh MULTIOS duplicating a stream).

// Derived from `__dirname` (handles both path separators) to avoid a `path`/`upath` import.
const REPO_ROOT = __dirname.replace(/[\\/]packages[\\/]datadog-ci[\\/]src[\\/]__tests__$/, '')
const CLI_ENTRY = 'packages/datadog-ci/src/cli.ts' // resolved relative to REPO_ROOT (the spawn cwd)
const TSX_CLI = require.resolve('tsx/cli')

const BANNER = /datadog-ci v\d/

const runCli = (args: string[], extraEnv: Record<string, string> = {}) => {
  const result = spawnSync(process.execPath, [TSX_CLI, '--conditions=development', CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {...process.env, ...extraEnv},
    timeout: 60_000,
  })
  if (result.error) {
    throw result.error
  }

  return {stdout: result.stdout, stderr: result.stderr, status: result.status}
}

describe('version banner (cli entry point)', () => {
  // tsx cold-starts on each spawn, so give these more room than the 5s default.
  jest.setTimeout(120_000)

  test('writes the auto banner to stderr, never stdout', () => {
    // `trace --dry-run` parses into a real command (BaseCommand path) and bails offline
    // at the CI-provider check, so no network is needed.
    const {stdout, stderr} = runCli(['trace', '--dry-run', '--', 'echo', 'hi'])

    expect(stderr).toMatch(BANNER)
    // The assertion that guards the bug: the banner must stay out of captured stdout.
    expect(stdout).not.toMatch(BANNER)
  })

  test('mirrors --log-format json: banner is a JSON line on stderr, still not on stdout', () => {
    const {stdout, stderr} = runCli(['trace', '--dry-run', '--log-format', 'json', '--', 'echo', 'hi'])

    expect(stderr).toContain(JSON.stringify({level: 'info', message: `datadog-ci v${cliVersion}`}))
    expect(stdout).not.toMatch(BANNER)
  })

  test('keeps stdout clean even on a command-line parse error', () => {
    // Parse errors fall back to a default logger; the banner must still avoid stdout.
    const {stdout, stderr} = runCli(['this-command-does-not-exist'])

    expect(stderr).toMatch(BANNER)
    expect(stdout).not.toMatch(BANNER)
  })

  test.each(['version', '--version'])('prints the version to stdout for %p without the auto banner', (arg) => {
    // `printVersion` skips these, so clipanion's builtin is the only thing that prints the
    // version — to stdout. Guards against the auto banner double-printing on stderr.
    const {stdout, stderr} = runCli([arg])

    expect(stdout).toContain(cliVersion)
    expect(stderr).not.toMatch(BANNER)
  })

  test('DD_CI_SKIP_VERSION_BANNER suppresses the banner on both streams', () => {
    const {stdout, stderr} = runCli(['this-command-does-not-exist'], {DD_CI_SKIP_VERSION_BANNER: '1'})

    expect(stdout).not.toMatch(BANNER)
    expect(stderr).not.toMatch(BANNER)
  })
})
