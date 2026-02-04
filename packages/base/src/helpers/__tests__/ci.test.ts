import fs from 'fs'

import {BaseContext} from 'clipanion'
import upath from 'upath'

import {
  getCIEnv,
  getCIMetadata,
  getCISpanTags,
  getGithubJobNameFromLogs,
  githubWellKnownDiagnosticDirsUnix,
  githubWellKnownDiagnosticDirsWin,
  isGithubWindowsRunner,
  isInteractive,
  shouldGetGithubJobDisplayName,
} from '../ci'
import {SpanTags} from '../interfaces'
import {
  CI_ENV_VARS,
  CI_NODE_LABELS,
  CI_NODE_NAME,
  GIT_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH,
  GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA,
  GIT_PULL_REQUEST_BASE_BRANCH_SHA,
  PR_NUMBER,
} from '../tags'
import {getUserCISpanTags, getUserGitSpanTags} from '../user-provided-git'

import {createMockContext} from './testing-tools'

const CI_PROVIDERS = fs.readdirSync(upath.join(__dirname, 'ci-env'))

const ddMetadataToSpanTags = (ddMetadata: {[key: string]: string}): SpanTags => {
  const spanTags: SpanTags = {}
  Object.entries(ddMetadata).map(([key, value]) => {
    let tagKey = key.split('_').slice(1).join('.').toLocaleLowerCase() // Split and remove DD prefix

    if (tagKey === 'git.repository.url') {
      tagKey = 'git.repository_url'
    } else if (tagKey === 'git.pull.request.base.branch') {
      tagKey = 'git.pull_request.base_branch'
    } else if (tagKey === 'git.pull.request.base.branch.sha') {
      tagKey = 'git.pull_request.base_branch_sha'
    } else if (tagKey === 'ci.workspace.path') {
      tagKey = 'ci.workspace_path'
    }

    spanTags[tagKey as keyof SpanTags] = value
  })

  return spanTags
}

describe('getCIMetadata', () => {
  test('non-recognized CI returns undefined', () => {
    process.env = {}
    expect(getCIMetadata()).toBeUndefined()
  })

  test('pipeline number is parsed to int or ignored', () => {
    process.env = {GITLAB_CI: 'gitlab'}

    process.env.CI_PIPELINE_IID = '0'
    expect(getCIMetadata()?.ci.pipeline.number).toBe(0)
    process.env.CI_PIPELINE_IID = ' \n\r 12345 \n\n '
    expect(getCIMetadata()?.ci.pipeline.number).toBe(12345)
    process.env.CI_PIPELINE_IID = '123.45'
    expect(getCIMetadata()?.ci.pipeline.number).toBe(123)
    process.env.CI_PIPELINE_IID = '999b'
    expect(getCIMetadata()?.ci.pipeline.number).toBe(999)
    process.env.CI_PIPELINE_IID = '-1'
    expect(getCIMetadata()?.ci.pipeline.number).toBe(-1)

    process.env.CI_PIPELINE_IID = ''
    expect(getCIMetadata()?.ci.pipeline.number).toBeUndefined()
    process.env.CI_PIPELINE_IID = 'not a number'
    expect(getCIMetadata()?.ci.pipeline.number).toBeUndefined()
    process.env.CI_PIPELINE_IID = '$1'
    expect(getCIMetadata()?.ci.pipeline.number).toBeUndefined()
  })

  test('tags are properly truncated when required', () => {
    const bigString = ''.padEnd(1600, 'a')
    process.env = {GITLAB_CI: 'gitlab'}

    process.env.CI_COMMIT_MESSAGE = bigString
    process.env.CI_COMMIT_TAG = bigString
    expect(getCIMetadata()?.git.commit.message).toBe(bigString)
    expect(getCIMetadata()?.git.tag).toBe(bigString)

    const tagSizeLimits = {
      'git.commit.message': 500,
    }
    expect(getCIMetadata(tagSizeLimits)?.git.commit.message).toBe(bigString.substring(0, 500))
    expect(getCIMetadata(tagSizeLimits)?.git.tag).toBe(bigString)
  })

  describe.each(CI_PROVIDERS)('%s', (ciProvider) => {
    const assertions = require(upath.join(__dirname, 'ci-env', ciProvider)) as [
      {[key: string]: string},
      {[tag: string]: string},
    ][]

    for (const assertion of assertions) {
      const env = assertion[0]
      for (const [k, v] of Object.entries(env)) {
        if (typeof v !== 'string') {
          env[k] = String(v)
        }
      }
    }

    test.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = env

      expect(getTags()).toEqual(tags)
    })
  })

  describe.each(CI_PROVIDERS)('Ensure DD env variables override %s env variables', (ciProvider) => {
    const DD_METADATA = {
      DD_CI_JOB_ID: 'DD_CI_JOB_ID',
      DD_CI_JOB_NAME: 'DD_CI_JOB_NAME',
      DD_CI_JOB_URL: 'DD_CI_JOB_URL',
      DD_CI_PIPELINE_ID: 'DD_CI_PIPELINE_ID',
      DD_CI_PIPELINE_NAME: 'DD_CI_PIPELINE_NAME',
      DD_CI_PIPELINE_NUMBER: 'DD_CI_PIPELINE_NUMBER',
      DD_CI_PIPELINE_URL: 'DD_CI_PIPELINE_URL',
      DD_CI_PROVIDER_NAME: 'DD_CI_PROVIDER_NAME',
      DD_CI_STAGE_NAME: 'DD_CI_STAGE_NAME',
      DD_CI_WORKSPACE_PATH: 'DD_CI_WORKSPACE_PATH',
      DD_GIT_BRANCH: 'DD_GIT_BRANCH',
      DD_GIT_COMMIT_AUTHOR_DATE: 'DD_GIT_COMMIT_AUTHOR_DATE',
      DD_GIT_COMMIT_AUTHOR_EMAIL: 'DD_GIT_COMMIT_AUTHOR_EMAIL',
      DD_GIT_COMMIT_AUTHOR_NAME: 'DD_GIT_COMMIT_AUTHOR_NAME',
      DD_GIT_COMMIT_COMMITTER_DATE: 'DD_GIT_COMMIT_COMMITTER_DATE',
      DD_GIT_COMMIT_COMMITTER_EMAIL: 'DD_GIT_COMMIT_COMMITTER_EMAIL',
      DD_GIT_COMMIT_COMMITTER_NAME: 'DD_GIT_COMMIT_COMMITTER_NAME',
      DD_GIT_COMMIT_MESSAGE: 'DD_GIT_COMMIT_MESSAGE',
      DD_GIT_COMMIT_SHA: 'DD_GIT_COMMIT_SHA',
      DD_GIT_REPOSITORY_URL: 'DD_GIT_REPOSITORY_URL',
      DD_GIT_TAG: 'DD_GIT_TAG',
      DD_GIT_COMMIT_HEAD_SHA: 'DD_GIT_COMMIT_HEAD_SHA',
      DD_GIT_PULL_REQUEST_BASE_BRANCH: 'DD_GIT_PULL_REQUEST_BASE_BRANCH',
      DD_GIT_PULL_REQUEST_BASE_BRANCH_SHA: 'DD_GIT_PULL_REQUEST_BASE_BRANCH_SHA',
    }

    const expectedMetadata = ddMetadataToSpanTags(DD_METADATA)

    const assertions = require(upath.join(__dirname, 'ci-env', ciProvider)) as [
      {[key: string]: string},
      {[tag: string]: string},
    ][]

    it.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = {...env, ...DD_METADATA}
      const ciMetadata = getTags()
      // the tags below are deleted as they cannot be overridden by DD env variables
      // so we should ignore them in the comparison
      delete ciMetadata?.[CI_ENV_VARS]
      delete ciMetadata?.[CI_NODE_LABELS]
      delete ciMetadata?.[CI_NODE_NAME]
      delete ciMetadata?.[PR_NUMBER]
      delete ciMetadata?.[GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA]
      expect(ciMetadata).toEqual(expectedMetadata)
    })
  })
})

describe('ci spec', () => {
  test('returns an empty object if the CI is not supported', () => {
    process.env = {}
    const tags = {
      ...getCISpanTags(),
      ...getUserCISpanTags(),
      ...getUserGitSpanTags(),
    }
    expect(tags).toEqual({})
  })

  CI_PROVIDERS.forEach((ciProvider) => {
    const assertions = require(upath.join(__dirname, 'ci-env', ciProvider)) as [
      {[key: string]: string},
      {[key: string]: string},
    ][]

    if (ciProvider === 'github.json') {
      describe('github actions pull request events', () => {
        afterEach(() => {
          delete process.env.GITHUB_BASE_REF
          delete process.env.GITHUB_EVENT_PATH
        })
        // We grab the first assertion because we only need to test one
        const [env] = assertions[0]

        it('can read pull request data from GitHub Actions', () => {
          process.env = env
          process.env.GITHUB_BASE_REF = 'datadog:main'
          process.env.GITHUB_EVENT_PATH = upath.join(__dirname, 'ci-fixtures', 'github_event_payload.json')
          const {
            [GIT_PULL_REQUEST_BASE_BRANCH]: pullRequestBaseBranch,
            [GIT_PULL_REQUEST_BASE_BRANCH_HEAD_SHA]: pullRequestBaseBranchHeadSha,
            [GIT_HEAD_SHA]: headCommitSha,
            [PR_NUMBER]: prNumber,
          } = getCISpanTags() as SpanTags

          expect({
            pullRequestBaseBranch,
            pullRequestBaseBranchHeadSha,
            headCommitSha,
            prNumber,
          }).toEqual({
            pullRequestBaseBranch: 'datadog:main',
            pullRequestBaseBranchHeadSha: '52e0974c74d41160a03d59ddc73bb9f5adab054b',
            headCommitSha: 'df289512a51123083a8e6931dd6f57bb3883d4c4',
            prNumber: '1',
          })
        })

        it('does not crash if GITHUB_EVENT_PATH is not a valid JSON file', () => {
          process.env = env
          process.env.GITHUB_BASE_REF = 'datadog:main'
          process.env.GITHUB_EVENT_PATH = upath.join(__dirname, 'fixtures', 'github_event_payload_malformed.json')
          const {
            [GIT_PULL_REQUEST_BASE_BRANCH]: pullRequestBaseBranch,
            [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: pullRequestBaseBranchSha,
            [GIT_HEAD_SHA]: headCommitSha,
          } = getCISpanTags() as SpanTags

          expect(pullRequestBaseBranch).toEqual('datadog:main')
          expect(pullRequestBaseBranchSha).toBeUndefined()
          expect(headCommitSha).toBeUndefined()
        })

        it('does not crash if GITHUB_EVENT_PATH is not a file', () => {
          process.env = env
          process.env.GITHUB_BASE_REF = 'datadog:main'
          process.env.GITHUB_EVENT_PATH = upath.join(__dirname, 'fixtures', 'does_not_exist.json')
          const {
            [GIT_PULL_REQUEST_BASE_BRANCH]: pullRequestBaseBranch,
            [GIT_PULL_REQUEST_BASE_BRANCH_SHA]: pullRequestBaseBranchSha,
            [GIT_HEAD_SHA]: headCommitSha,
          } = getCISpanTags() as SpanTags

          expect(pullRequestBaseBranch).toEqual('datadog:main')
          expect(pullRequestBaseBranchSha).toBeUndefined()
          expect(headCommitSha).toBeUndefined()
        })
      })
    }

    assertions.forEach(([env, expectedSpanTags], index) => {
      test(`reads env info for spec ${index} from ${ciProvider}`, () => {
        process.env = env
        const tags = {
          ...getCISpanTags(),
          ...getUserGitSpanTags(),
        }

        const {[CI_ENV_VARS]: envVars, [CI_NODE_LABELS]: nodeLabels, ...restOfTags} = tags
        const {
          [CI_ENV_VARS]: expectedEnvVars,
          [CI_NODE_LABELS]: expectedNodeLabels,
          ...restOfExpectedTags
        } = expectedSpanTags
        expect(restOfTags).toEqual(restOfExpectedTags)

        // `CI_ENV_VARS` key contains a dictionary, so we JSON parse it
        if (envVars && expectedEnvVars) {
          // eslint-disable-next-line jest/no-conditional-expect
          expect(JSON.parse(envVars)).toEqual(JSON.parse(expectedEnvVars))
        }
        // `CI_NODE_LABELS` key contains an array, so we JSON parse it
        if (nodeLabels && expectedNodeLabels) {
          // eslint-disable-next-line jest/no-conditional-expect
          expect(JSON.parse(nodeLabels)).toEqual(expect.arrayContaining(JSON.parse(expectedNodeLabels)))
        }
      })
    })
  })
})

describe('getCIEnv', () => {
  test('unsupported CI provider', () => {
    process.env = {APPVEYOR: 'true'}
    expect(() => {
      getCIEnv()
    }).toThrow('Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported')
  })

  test('buildkite', () => {
    process.env = {BUILDKITE: 'true'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {BUILDKITE: 'true', BUILDKITE_BUILD_ID: 'build-id', BUILDKITE_JOB_ID: 'job-id'}
    expect(getCIEnv()).toEqual({
      ciEnv: {BUILDKITE_BUILD_ID: 'build-id', BUILDKITE_JOB_ID: 'job-id'},
      provider: 'buildkite',
    })
  })

  test('circleci', () => {
    process.env = {CIRCLECI: 'true'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {CIRCLECI: 'true', CIRCLE_WORKFLOW_ID: 'build-id', CIRCLE_BUILD_NUM: '10'}
    expect(getCIEnv()).toEqual({
      ciEnv: {CIRCLE_WORKFLOW_ID: 'build-id', CIRCLE_BUILD_NUM: '10'},
      provider: 'circleci',
    })
  })

  test('gitlab', () => {
    process.env = {GITLAB_CI: 'true'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {GITLAB_CI: 'true', CI_PIPELINE_ID: 'build-id', CI_JOB_ID: '10', CI_PROJECT_URL: 'url'}
    expect(getCIEnv()).toEqual({
      ciEnv: {CI_PIPELINE_ID: 'build-id', CI_JOB_ID: '10', CI_PROJECT_URL: 'url'},
      provider: 'gitlab',
    })
  })

  test('jenkins', () => {
    process.env = {JENKINS_URL: 'something'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {JENKINS_URL: 'something', DD_CUSTOM_PARENT_ID: 'span-id', DD_CUSTOM_TRACE_ID: 'trace-id'}
    expect(getCIEnv()).toEqual({
      ciEnv: {DD_CUSTOM_PARENT_ID: 'span-id', DD_CUSTOM_TRACE_ID: 'trace-id'},
      provider: 'jenkins',
    })
  })

  test('teamcity', () => {
    process.env = {TEAMCITY_VERSION: 'something'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {TEAMCITY_VERSION: 'something', DATADOG_BUILD_ID: 'build-id'}
    expect(getCIEnv()).toEqual({
      ciEnv: {DATADOG_BUILD_ID: 'build-id'},
      provider: 'teamcity',
    })
  })

  test('azurepipelines', () => {
    process.env = {TF_BUILD: 'something'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {
      TF_BUILD: 'something',
      SYSTEM_TEAMPROJECTID: 'project-id',
      BUILD_BUILDID: '55',
      SYSTEM_JOBID: 'job-id',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {SYSTEM_TEAMPROJECTID: 'project-id', BUILD_BUILDID: '55', SYSTEM_JOBID: 'job-id'},
      provider: 'azurepipelines',
    })
  })
})

describe('isInteractive', () => {
  let originalEnv: NodeJS.ProcessEnv
  let mockStream: Partial<NodeJS.WriteStream>

  beforeEach(() => {
    originalEnv = {...process.env}
    mockStream = {isTTY: true}
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('returns true when not in CI, TERM is not "dumb", and stream isTTY is true', () => {
    delete process.env.CI
    process.env.TERM = 'xterm'

    expect(isInteractive({stream: mockStream as NodeJS.WriteStream})).toBe(true)
  })

  test('returns false when in CI', () => {
    process.env.CI = 'true'
    process.env.TERM = 'xterm'

    expect(isInteractive({stream: mockStream as NodeJS.WriteStream})).toBe(false)
  })

  test('returns false when TERM is "dumb"', () => {
    delete process.env.CI
    process.env.TERM = 'dumb'

    expect(isInteractive({stream: mockStream as NodeJS.WriteStream})).toBe(false)
  })

  test('returns false when stream is not a TTY', () => {
    delete process.env.CI
    process.env.TERM = 'xterm'
    mockStream.isTTY = false

    expect(isInteractive({stream: mockStream as NodeJS.WriteStream})).toBe(false)
  })

  test('returns false when stream is undefined', () => {
    delete process.env.CI
    process.env.TERM = 'xterm'

    expect(isInteractive({stream: undefined})).toBe(false)
  })

  test('uses default process.stdout when no stream is provided', () => {
    delete process.env.CI
    process.env.TERM = 'xterm'
    process.stdout.isTTY = true

    expect(isInteractive()).toBe(true)
  })

  test('returns false when process.stdout is not a TTY and no stream is provided', () => {
    delete process.env.CI
    process.env.TERM = 'xterm'
    process.stdout.isTTY = false

    expect(isInteractive()).toBe(false)
  })
})

describe('getGithubJobDisplayNameFromLogs', () => {
  const mockedFs = fs as jest.Mocked<typeof fs>

  beforeEach(() => {
    process.env = {
      GITHUB_ACTIONS: 'true',
    }
  })
  afterEach(() => {
    jest.resetAllMocks()
  })

  const getNotFoundFsError = (): Error => {
    const error = new Error('not found')
    Object.assign(error, {code: 'ENOENT'})

    return error
  }

  const mockLogFileDirent = (logFileName: string) => {
    return {
      name: logFileName as any,
      isFile: () => true,
      isDirectory: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isSymbolicLink: () => false,
      isFIFO: () => false,
      isSocket: () => false,
      parentPath: '',
      path: '',
    }
  }

  const sampleLogContent = (jobDisplayName: string): string => `
    [2025-09-15 10:14:00Z INFO Worker] Waiting to receive the job message from the channel.
    [2025-09-15 10:14:00Z INFO ProcessChannel] Receiving message of length 22985, with hash 'abcdef'
    [2025-09-15 10:14:00Z INFO Worker] Message received.
    [2025-09-15 10:14:00Z INFO Worker] Job message:
    {
      "jobId": "95a4619c-e316-542f-8a21-74cd5a8ac9ca",
      "jobDisplayName": ${JSON.stringify(jobDisplayName)},
      "jobName": "__default"
    }`

  const sampleLogContentWithPlanId = (jobDisplayName: string, planId: string): string => `
    [2025-09-15 10:14:00Z INFO Worker] Waiting to receive the job message from the channel.
    [2025-09-15 10:14:00Z INFO ProcessChannel] Receiving message of length 22985, with hash 'abcdef'
    [2025-09-15 10:14:00Z INFO Worker] Message received.
    [2025-09-15 10:14:00Z INFO Worker] Job message:
    {
      "planId": "${planId}",
      "jobId": "95a4619c-e316-542f-8a21-74cd5a8ac9ca",
      "jobDisplayName": ${JSON.stringify(jobDisplayName)},
      "jobName": "__default"
    }`

  const sampleLogFileName = 'Worker_20251014-083000.log'
  const sampleJobDisplayName = 'build-and-test'

  const mockReaddirSync = (targetDir: fs.PathLike, logFileName: string) => {
    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      if (String(pathToRead) === String(targetDir)) {
        return [mockLogFileDirent(logFileName)]
      }
      throw getNotFoundFsError()
    })
  }

  test('should find and return the job display name (SaaS)', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[0] // SaaS directory
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name (self-hosted)', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[1] // self-hosted directory
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name in opt directory', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[2]
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name windows (SaaS)', () => {
    process.env.RUNNER_OS = 'Windows'
    const targetDir = githubWellKnownDiagnosticDirsWin[0]
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name windows (self-hosted)', () => {
    process.env.RUNNER_OS = 'Windows'
    const targetDir = githubWellKnownDiagnosticDirsWin[1]
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should check multiple log files until the display name is found', () => {
    const logContent1 = 'no job display name here'
    const logContent2 = 'nor here'
    const logContent3 = sampleLogContent('my job name')

    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      return [mockLogFileDirent('Worker_1.log'), mockLogFileDirent('Worker_2.log'), mockLogFileDirent('Worker_3.log')]
    })
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent1)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent2)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent3)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe('my job name')
  })

  test('no diagnostic log directories found', () => {
    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      throw getNotFoundFsError()
    })

    const context = createMockContext() as BaseContext
    const jobName = getGithubJobNameFromLogs(context)

    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('could not find GitHub diagnostic log files')
  })

  test('no worker log files found in any directory', () => {
    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      return [mockLogFileDirent('random_file_1'), mockLogFileDirent('random_file_2')]
    })

    const context = createMockContext() as BaseContext
    const jobName = getGithubJobNameFromLogs(context)

    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('could not find GitHub diagnostic log files')
  })

  test('should derive and try the diag dir from RUNNER_TEMP', () => {
    const runnerTemp = '/home/actions/actions-runner/_work/_temp'
    process.env.RUNNER_TEMP = runnerTemp
    const runnerRoot = upath.resolve(runnerTemp, '..', '..')
    const derivedDiagDir = upath.join(runnerRoot, '_diag')
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(derivedDiagDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
  })

  test('log files found but none contain the display name', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[0]
    const logContent = 'This log does not have the job display name.'

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const context = createMockContext() as BaseContext
    const jobName = getGithubJobNameFromLogs(context)

    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('could not find "jobDisplayName" attribute in GitHub diagnostic logs')
  })

  test('reading a directory throws an unexpected error', () => {
    const accessDeniedError = new Error('access denied')
    Object.assign(accessDeniedError, {code: 'EACCES'})

    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      throw accessDeniedError
    })

    const context = createMockContext() as BaseContext
    const jobName = getGithubJobNameFromLogs(context)

    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('error reading GitHub diagnostic log files: access denied')
  })

  test('other unexpected errors', () => {
    const err = Error('some error')

    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      throw err
    })

    const context = createMockContext() as BaseContext
    let jobName = getGithubJobNameFromLogs(context)

    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('error reading GitHub diagnostic log files: some error')

    const stringErr = 'hello error'
    jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw stringErr
    })

    jobName = getGithubJobNameFromLogs(context)
    expect(jobName).toBe(undefined)
    expect(context.stderr.toString()).toContain('error reading GitHub diagnostic log files: hello error')
  })

  // Comprehensive tests for job names with special characters
  describe('job names with quotes', () => {
    test('should parse job name with single quoted word', () => {
      const jobName = 'Build "production" artifacts'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with multiple quotes', () => {
      const jobName = 'Test "foo" and "bar"'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse complex job name with quotes and special chars', () => {
      const jobName = 'End-to-End Tests (@org/backend, "features/a*", apps/backend)'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('job names with backslashes', () => {
    test('should parse job name with Windows paths', () => {
      const jobName = 'Path\\\\to\\\\file'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with regex patterns', () => {
      const jobName = 'Regex \\\\d+ test'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with literal escape sequences', () => {
      const jobName = 'Literal \\\\n and \\\\t'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('matrix jobs', () => {
    test('should parse basic matrix job', () => {
      const jobName = 'Build (ubuntu-latest, 18.x)'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse matrix job with quotes', () => {
      const jobName = 'Test (macos, "3.9")'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('reusable workflows', () => {
    test('should parse job name with slashes', () => {
      const jobName = 'Terraform CI / Validate'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with multiple levels', () => {
      const jobName = 'CI / CD / Deploy'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('unicode and emojis', () => {
    test('should parse job name with emojis', () => {
      const jobName = '🚀 Deploy to production'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Chinese characters', () => {
      const jobName = '测试任务'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Japanese characters', () => {
      const jobName = 'テストジョブ'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Arabic characters', () => {
      const jobName = 'اختبار العمل'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Cyrillic characters', () => {
      const jobName = 'Тестовое задание'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('special characters', () => {
    test('should parse job name with parentheses and brackets', () => {
      const jobName = 'Test [feature] (branch)'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with symbols', () => {
      const jobName = 'Build @scope/package #123'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('complex combinations', () => {
    test('should parse job name with everything combined', () => {
      const jobName = '🔧 Build "app-v2.0" (@org/repo, ubuntu-latest, node-18.x) ✅'
      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('Worker log identification with ACTIONS_ORCHESTRATION_ID', () => {
    test('should use ACTIONS_ORCHESTRATION_ID to find correct Worker log', () => {
      const planId = '9f25551c-ce16-4f8f-a662-8575df3d1354'
      const originalEnv = process.env
      process.env = {...originalEnv, ACTIONS_ORCHESTRATION_ID: `${planId}.test-job.__default`}

      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContentWithPlanId('correct-job-name', planId)

      mockReaddirSync(targetDir, 'Worker_20251014-083000.log')
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(jobName).toBe('correct-job-name')
      process.env = originalEnv
    })

    test('should select correct log among multiple Worker logs on non-ephemeral runner', () => {
      const correctPlanId = '9f25551c-ce16-4f8f-a662-8575df3d1354'
      const wrongPlanId = '12345678-1234-1234-1234-123456789abc'
      const originalEnv = process.env
      process.env = {...originalEnv, ACTIONS_ORCHESTRATION_ID: `${correctPlanId}.test-job.__default`}

      const targetDir = githubWellKnownDiagnosticDirsUnix[0]

      // Multiple Worker logs from different runs
      jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
        if (String(pathToRead) === String(targetDir)) {
          return [
            mockLogFileDirent('Worker_20251014-083000.log'), // Old job
            mockLogFileDirent('Worker_20251014-090000.log'), // Current job
            mockLogFileDirent('Worker_20251014-095000.log'), // Another old job
          ]
        }
        throw getNotFoundFsError()
      })

      jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
        const filePathStr = String(filePath)
        if (filePathStr.includes('Worker_20251014-083000.log')) {
          return sampleLogContentWithPlanId('old-job-name-1', wrongPlanId)
        }
        if (filePathStr.includes('Worker_20251014-090000.log')) {
          return sampleLogContentWithPlanId('correct-job-name', correctPlanId)
        }
        if (filePathStr.includes('Worker_20251014-095000.log')) {
          return sampleLogContentWithPlanId('old-job-name-2', '87654321-4321-4321-4321-cba987654321')
        }

        return ''
      })

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(jobName).toBe('correct-job-name')
      // Should read 2 logs searching for planId, then read the matched log again = 3 total
      expect(fs.readFileSync).toHaveBeenCalledTimes(3)
      process.env = originalEnv
    })

    test('should fall back to first match when ACTIONS_ORCHESTRATION_ID not available', () => {
      const originalEnv = process.env
      process.env = {...originalEnv}
      delete process.env.ACTIONS_ORCHESTRATION_ID

      const targetDir = githubWellKnownDiagnosticDirsUnix[0]
      const logContent = sampleLogContent('first-job-found')

      mockReaddirSync(targetDir, 'Worker_20251014-083000.log')
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(jobName).toBe('first-job-found')
      process.env = originalEnv
    })

    test('should fall back to checking all logs if planId not found', () => {
      const searchPlanId = '9f25551c-ce16-4f8f-a662-8575df3d1354'
      const originalEnv = process.env
      process.env = {...originalEnv, ACTIONS_ORCHESTRATION_ID: `${searchPlanId}.test-job.__default`}

      const targetDir = githubWellKnownDiagnosticDirsUnix[0]

      jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
        if (String(pathToRead) === String(targetDir)) {
          return [mockLogFileDirent('Worker_20251014-083000.log')]
        }
        throw getNotFoundFsError()
      })

      // Log contains different planId, but still has jobDisplayName
      jest.spyOn(fs, 'readFileSync').mockReturnValue(
        sampleLogContentWithPlanId('fallback-job-name', 'different-plan-id')
      )

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(jobName).toBe('fallback-job-name')
      process.env = originalEnv
    })
  })
})

describe('shouldGetGitHubJobDisplayName', () => {
  test('should get github display name', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
    }
    expect(shouldGetGithubJobDisplayName()).toBe(true)
  })

  test('should not get github display name if set manually', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      DD_GITHUB_JOB_NAME: 'value set by user',
    }
    expect(shouldGetGithubJobDisplayName()).toBe(false)
  })

  test('should not get github display name if not from GitHub', () => {
    process.env = {
      CIRCLECI: 'true',
    }
    expect(shouldGetGithubJobDisplayName()).toBe(false)
  })
})

describe('isGithubWindowsRunner', () => {
  test('linux runner', () => {
    process.env = {
      RUNNER_OS: 'Linux',
    }
    expect(isGithubWindowsRunner()).toBe(false)
  })

  test('mac runner', () => {
    process.env = {
      RUNNER_OS: 'macOS',
    }
    expect(isGithubWindowsRunner()).toBe(false)
  })

  test('windows runner', () => {
    process.env = {
      RUNNER_OS: 'Windows',
    }
    expect(isGithubWindowsRunner()).toBe(true)
  })
})

const getTags = (): SpanTags => {
  return {
    ...getCISpanTags(),
    ...getUserCISpanTags(),
    ...getUserGitSpanTags(),
  }
}
