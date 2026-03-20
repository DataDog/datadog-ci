import child_process from 'node:child_process'

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

// In CI the synthetic project installs @datadog/datadog-ci from artifact
// tarballs, so `yarn datadog-ci` works. Locally, create an e2e/.env.local
// file with DATADOG_CI_COMMAND='yarn launch' to run from source via tsx.
export const DATADOG_CI_COMMAND = process.env.DATADOG_CI_COMMAND ?? 'yarn datadog-ci'

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

export const execSync = (command: string, env?: Record<string, string | undefined>): string => {
  return child_process.execSync(command, {
    encoding: 'utf-8',
    env: {...process.env, ...env},
  })
}
