import child_process from 'node:child_process'

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

// In CI the synthetic project installs @datadog/datadog-ci from artifact
// tarballs, so `yarn datadog-ci` works. Locally, set DATADOG_CI_COMMAND='yarn launch'
// in e2e/.env.local (gitignored) to run from source via tsx.
export const DATADOG_CI_COMMAND = process.env.DATADOG_CI_COMMAND ?? 'yarn datadog-ci'

/**
 * Child env for org-action commands (synthetics, sbom upload). When an access token is set, as in the WIF e2e job, run
 * the command with the token only: the API keys and application keys are removed from the child env, so the documented
 * token-only setup is what gets tested. Without a token, the given keys are used unchanged.
 */
export const getOrgActionEnv = (keys: Record<string, string | undefined>): Record<string, string | undefined> =>
  process.env.DATADOG_ACCESS_TOKEN || process.env.DD_ACCESS_TOKEN
    ? {DATADOG_API_KEY: undefined, DD_API_KEY: undefined, DATADOG_APP_KEY: undefined, DD_APP_KEY: undefined}
    : keys

export const execPromise = async (command: string, env?: Record<string, string | undefined>): Promise<ExecResult> => {
  return new Promise((resolve) => {
    child_process.exec(command, {env: {...process.env, ...env}}, (error, stdout, stderr) => {
      if (error) {
        resolve({
          exitCode: typeof error.code === 'number' ? error.code : 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      } else {
        resolve({
          exitCode: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      }
    })
  })
}

// Transient cloud provider errors that are safe to retry
const RETRYABLE_PATTERNS = [
  'GatewayTimeout',
  'RestError',
  'Operation was canceled',
  'ETIMEDOUT',
  'ECONNRESET',
  "doesn't exist",
  'Conflict',
  'TooManyRequests',
  'ABORTED',
  'DEADLINE_EXCEEDED',
  'INTERNAL',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'temporarily unavailable',
  // The Kudu/SCM site returns a 502 gateway error on the first deploy while it is still cold
  'acting as a gateway or proxy',
  // AWS rate limits, which suites registering resources concurrently reach in bursts
  'ThrottlingException',
  'Rate exceeded',
]

const isRetryable = (result: ExecResult): boolean => {
  const output = `${result.stdout} ${result.stderr}`

  return RETRYABLE_PATTERNS.some((pattern) => output.includes(pattern))
}

export const execPromiseWithRetries = async (
  command: string,
  env?: Record<string, string | undefined>,
  {maxAttempts = 3, delaySeconds = 5}: {maxAttempts?: number; delaySeconds?: number} = {}
): Promise<ExecResult> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await execPromise(command, env)
    if (result.exitCode === 0) {
      return result
    }
    if (attempt < maxAttempts && isRetryable(result)) {
      console.log(
        `Command failed with retryable error (attempt ${attempt}/${maxAttempts}), retrying in ${delaySeconds}s...`
      )
      console.log(`stdout: ${result.stdout}`)
      console.log(`stderr: ${result.stderr}`)
      await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000))
    } else {
      return result
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('Unexpected: exhausted retries without returning')
}

export const execSync = (command: string, env?: Record<string, string | undefined>): string => {
  return child_process.execSync(command, {
    encoding: 'utf-8',
    env: {...process.env, ...env},
  })
}
