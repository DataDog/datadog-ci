import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {Environment} from '../types'

export const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'ci-visibility-test-'))
  const buffer = join(root, 'records')
  const diagnostic = join(root, '_diag')
  mkdirSync(buffer)
  mkdirSync(diagnostic)
  mkdirSync(join(root, '_work', '_temp'), {recursive: true})
  const env: Environment = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'example/project',
    GITHUB_RUN_ID: '100',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_JOB: 'build',
    GITHUB_ACTION: 'compile',
    GITHUB_WORKFLOW: 'CI',
    GITHUB_SHA: 'abc123',
    GITHUB_REF: 'refs/heads/main',
    RUNNER_TEMP: join(root, '_work', '_temp'),
  }
  const writeLog = (name = 'Worker_20260101.log', jobName = 'Build', orchestration = 'plan.build.default') => {
    const log = `Job message: ${JSON.stringify({
      jobDisplayName: jobName,
      contextData: {job: {d: [{k: 'check_run_id', v: 200}]}},
      variables: {'system.orchestrationId': {value: orchestration}},
      steps: [
        {contextName: 'checkout'},
        {contextName: 'compile', displayName: 'Compile [sources]'},
        {contextName: 'test'},
      ],
    })}`
    writeFileSync(join(diagnostic, name), log)
  }
  writeLog()

  return {root, buffer, diagnostic, env, writeLog, cleanup: () => rmSync(root, {recursive: true, force: true})}
}
