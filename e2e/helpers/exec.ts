import child_process from 'node:child_process'

export interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

// In CI the synthetic project installs @datadog/datadog-ci from artifact
// tarballs, so `yarn datadog-ci` works. Locally, `yarn launch` runs from
// source via tsx. Override with DATADOG_CI_COMMAND env var.
export const DATADOG_CI_COMMAND = process.env.DATADOG_CI_COMMAND ?? 'yarn datadog-ci'

export const execPromise = async (command: string, env?: Record<string, string | undefined>): Promise<ExecResult> => {
  return new Promise((resolve) => {
    child_process.exec(command, {env: {...process.env, ...env}}, (error, stdout, stderr) => {
      if (error) {
        resolve({
          exitCode: error.code || 1,
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
