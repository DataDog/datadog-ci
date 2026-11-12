import fs, {mkdirSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {createGithubContext, diagnosticRoots} from '../github'

import {fixture} from './helpers'

describe('GitHub context', () => {
  let data: ReturnType<typeof fixture>
  beforeEach(() => {
    data = fixture()
  })
  afterEach(() => {
    data.cleanup()
    jest.restoreAllMocks()
  })

  test('discovers job identity and steps, caching log contents', () => {
    const capture = createGithubContext(data.env)
    expect(capture()).toMatchObject({
      ciEnv: {DD_GITHUB_JOB_NAME: 'Build', DD_GITHUB_STEP_INDEX: '1'},
      tags: {'ci.job.id': '200', 'git.branch': 'main', 'ci.pipeline.id': '100'},
      stepIndices: [0, 1, 2],
    })
    data.writeLog('Worker_20260101.log', 'Changed')
    data.env.GITHUB_ACTION = 'test'
    expect(capture().ciEnv).toMatchObject({DD_GITHUB_JOB_NAME: 'Build', DD_GITHUB_STEP_INDEX: '2'})
    data.env.DD_CI_PHASE = 'post'
    expect(capture().ciEnv.DD_GITHUB_STEP_INDEX).toBeUndefined()
    data.env.DD_CI_PHASE = 'main'
    data.env.GITHUB_ACTION = 'unknown'
    expect(capture().ciEnv.DD_GITHUB_JOB_NAME).toBe('Build')
    expect(capture().ciEnv.DD_GITHUB_STEP_INDEX).toBeUndefined()
  })

  test('selects orchestration identity instead of another job on the same runner', () => {
    data.writeLog('Worker_20260102.log', 'Other job', 'plan.other.matrix')
    data.env.ACTIONS_ORCHESTRATION_ID = 'plan.build.default'
    expect(createGithubContext(data.env)().ciEnv.DD_GITHUB_JOB_NAME).toBe('Build')
    data.env.ACTIONS_ORCHESTRATION_ID = 'plan.unknown.default'
    expect(createGithubContext(data.env)().ciEnv.DD_GITHUB_JOB_NAME).toBe('build')
  })

  test('stops reading historical logs after finding the current job', () => {
    data.writeLog('Worker_20251231.log', 'Old job')
    const read = jest.spyOn(fs, 'readFileSync')
    const capture = createGithubContext(data.env)
    expect(capture().ciEnv.DD_GITHUB_JOB_NAME).toBe('Build')
    expect(capture().ciEnv.DD_GITHUB_JOB_NAME).toBe('Build')
    expect(read.mock.calls.map(([file]) => file)).toEqual([join(data.diagnostic, 'Worker_20260101.log')])
  })

  test('skips partial and unrelated logs before stopping at a matching job', () => {
    data.writeLog('Worker_20251231.log', 'Old job')
    data.writeLog('Worker_20260102.log', 'Other job', 'plan.other.matrix')
    writeFileSync(join(data.diagnostic, 'Worker_20260103.log'), 'Partial worker log')
    data.env.ACTIONS_ORCHESTRATION_ID = 'plan.build.default'
    const read = jest.spyOn(fs, 'readFileSync')
    expect(createGithubContext(data.env)().ciEnv.DD_GITHUB_JOB_NAME).toBe('Build')
    expect(read.mock.calls.map(([file]) => file)).toEqual([
      join(data.diagnostic, 'Worker_20260103.log'),
      join(data.diagnostic, 'Worker_20260102.log'),
      join(data.diagnostic, 'Worker_20260101.log'),
    ])
  })

  test('handles versioned runner directories, escaped names, brackets, and a job hook', () => {
    const versioned = join(data.root, 'cached', 'v1')
    mkdirSync(versioned, {recursive: true})
    data.writeLog('Worker_20260101.log', 'Build "release" [linux]')
    renameSync(data.diagnostic, join(versioned, '_diag'))
    data.env.ACTIONS_RUNNER_HOOK_JOB_STARTED = join(data.root, 'hook')
    expect(createGithubContext(data.env)()).toMatchObject({
      ciEnv: {DD_GITHUB_JOB_NAME: 'Build "release" [linux]', DD_GITHUB_STEP_INDEX: '2'},
      stepIndices: [1, 2, 3],
    })
  })

  test('honors explicit overrides and obtains Git metadata from the event', () => {
    const event = join(data.root, 'event.json')
    writeFileSync(event, JSON.stringify({pull_request: {number: 42, head: {sha: 'head'}, base: {sha: 'base'}}}))
    Object.assign(data.env, {
      GITHUB_EVENT_PATH: event,
      GITHUB_HEAD_REF: 'feature',
      GITHUB_BASE_REF: 'main',
      DD_GITHUB_JOB_NAME: 'Explicit',
      JOB_CHECK_RUN_ID: '300',
      DD_GITHUB_STEP_INDEX: '7',
    })
    const context = createGithubContext(data.env)()
    expect(context.ciEnv).toMatchObject({DD_GITHUB_JOB_NAME: 'Explicit', DD_GITHUB_STEP_INDEX: '7'})
    expect(context.tags).toMatchObject({
      'ci.job.id': '300',
      'ci.job.url': 'https://github.com/example/project/actions/runs/100/job/300',
      'git.branch': 'feature',
      'git.commit.head.sha': 'head',
      'git.pull_request.base_branch_head_sha': 'base',
      'pr.number': '42',
    })
    expect(context.tags['git.pull_request.base_branch_sha']).toBeUndefined()
    expect(JSON.parse(context.tags['_dd.ci.env_vars'])).toMatchObject({GITHUB_RUN_ATTEMPT: '2'})
    expect(context.tags['git.commit.author.name']).toBeUndefined()
  })

  test('uses the commit checks page when a numeric job ID is unavailable', () => {
    fs.rmSync(data.diagnostic, {recursive: true})
    const context = createGithubContext(data.env)()
    expect(context.tags).toMatchObject({
      'ci.job.id': 'build',
      'ci.job.url': 'https://github.com/example/project/commit/abc123/checks',
    })
  })

  test('does not construct a job URL from an invalid explicit ID', () => {
    data.env.JOB_CHECK_RUN_ID = 'build'
    delete data.env.GITHUB_SHA
    expect(createGithubContext(data.env)().tags['ci.job.url']).toBeUndefined()
  })

  test.each([
    ['https://user:secret@example.com/project.git?token=secret#secret', 'https://example.com/project.git'],
    ['https://secret@example.com/project.git', 'https://example.com/project.git'],
    ['https://example.com/project.git', 'https://example.com/project.git'],
    ['ssh://git@example.com:2222/project.git', 'ssh://example.com:2222/project.git'],
    ['git@example.com:project.git', 'git@example.com:project.git'],
    ['https://user:secret@', undefined],
    ['data:text/plain,secret', undefined],
  ])('sanitizes repository metadata: %s', (url, sanitized) => {
    data.env.DD_GIT_REPOSITORY_URL = url
    expect(createGithubContext(data.env)().tags['git.repository_url']).toBe(sanitized)
  })

  test('uses Git tag semantics and tolerates malformed metadata', () => {
    data.env.GITHUB_REF = 'refs/tags/v1'
    data.env.GITHUB_EVENT_PATH = join(data.root, 'event.json')
    writeFileSync(data.env.GITHUB_EVENT_PATH, '{')
    const context = createGithubContext(data.env)()
    expect(context.tags['git.tag']).toBe('v1')
    expect(context.tags['git.branch']).toBeUndefined()
  })

  test('derives Windows and macOS installation roots without a path dependency', () => {
    expect(diagnosticRoots({RUNNER_OS: 'Windows', RUNNER_TEMP: 'D:\\runner\\_work\\_temp'})).toContain('D:\\runner')
    expect(diagnosticRoots({RUNNER_OS: 'macOS', RUNNER_TEMP: '/opt/runner/_work/_temp'})).toContain('/opt/runner')
  })
})
