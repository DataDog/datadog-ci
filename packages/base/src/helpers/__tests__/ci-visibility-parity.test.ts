import {copyFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {BaseContext} from 'clipanion'

import {getGithubJobIDFromLogs, getGithubJobNameFromLogs, getGithubStepInfoFromLogs} from '../ci'

import {createMockContext} from './testing-tools'

// Load the SDK source through Jest without adding a base-to-SDK build or runtime dependency.
const {createGithubContext} = jest.requireActual<{
  createGithubContext: (env: NodeJS.ProcessEnv) => () => {
    ciEnv: Record<string, string>
    tags: Record<string, string>
  }
}>('../../../../ci-visibility/src/github')

describe('CLI and SDK GitHub metadata parity', () => {
  const originalEnv = process.env
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'github-parity-'))
  })
  afterEach(() => {
    process.env = originalEnv
    rmSync(root, {recursive: true, force: true})
    jest.restoreAllMocks()
  })

  const standard = {jobName: 'Build (linux)', jobId: '200', stepIndex: 1}

  test.each([
    {name: 'standard job', fixture: 'basic', expected: standard},
    {name: 'first step', fixture: 'basic', action: 'checkout', expected: {...standard, stepIndex: 0}},
    {name: 'job-started hook', fixture: 'basic', hook: true, expected: {...standard, stepIndex: 2}},
    {
      name: 'quoted names and brackets inside strings',
      fixture: 'escaped',
      expected: {jobName: 'Build "release" [linux]', jobId: '300', stepIndex: 1},
    },
    {name: 'versioned runner directory', fixture: 'basic', versioned: true, expected: standard},
    {
      name: 'current orchestration despite a newer unrelated log',
      fixture: 'basic',
      unrelated: true,
      expected: standard,
    },
  ])('$name', ({fixture, expected, action = 'compile', hook, versioned, unrelated}) => {
    const diagnostic = versioned ? join(root, 'cached', 'v1', '_diag') : join(root, '_diag')
    mkdirSync(diagnostic, {recursive: true})
    const temp = join(root, '_work', '_temp')
    mkdirSync(temp, {recursive: true})
    copyFileSync(join(__dirname, 'fixtures', `github-worker-${fixture}.txt`), join(diagnostic, 'Worker_20260101.log'))
    if (unrelated) {
      copyFileSync(join(__dirname, 'fixtures', 'github-worker-escaped.txt'), join(diagnostic, 'Worker_20260102.log'))
    }
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_JOB: 'build',
      GITHUB_ACTION: action,
      RUNNER_TEMP: temp,
      RUNNER_OS: process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux',
      ACTIONS_ORCHESTRATION_ID: fixture === 'escaped' ? 'plan.other.matrix' : 'plan.build.default',
      ...(hook ? {ACTIONS_RUNNER_HOOK_JOB_STARTED: join(root, 'setup-runner')} : {}),
    }
    const context = createMockContext() as BaseContext
    const step = getGithubStepInfoFromLogs(context)
    const cli = {
      jobName: getGithubJobNameFromLogs(context),
      jobId: getGithubJobIDFromLogs(context),
      stepIndex: step.stepIndex,
    }
    const sdk = createGithubContext(process.env)()
    expect(cli).toEqual(expected)
    expect(step.jobDisplayName).toBe(cli.jobName)
    expect({
      jobName: sdk.ciEnv.DD_GITHUB_JOB_NAME,
      jobId: sdk.tags['ci.job.id'],
      stepIndex: Number(sdk.ciEnv.DD_GITHUB_STEP_INDEX),
    }).toEqual(cli)
  })
})
