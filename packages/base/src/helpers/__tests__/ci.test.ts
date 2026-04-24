import fs from 'fs'

import type {SpanTags} from '../interfaces'
import type {BaseContext} from 'clipanion'

import upath from 'upath'

jest.mock('../glob', () => {
  const actual = jest.requireActual('../glob') as typeof import('../glob')

  return {
    ...actual,
    globSync: jest.fn<string[], [string]>(() => []),
  }
})

import {globSync} from '../glob'

import {
  getCIEnv,
  getCIMetadata,
  getCISpanTags,
  getGithubJobNameFromLogs,
  getGithubStepInfoFromLogs,
  githubWellKnownDiagnosticDirPatternsUnix,
  githubWellKnownDiagnosticDirPatternsWin,
  githubWellKnownDiagnosticDirsUnix,
  githubWellKnownDiagnosticDirsWin,
  isGithubWindowsRunner,
  isInteractive,
  shouldGetGithubJobDisplayName,
} from '../ci'

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

const mockedGlobSync = globSync as jest.MockedFunction<typeof globSync>

// Synthetic hosted-runner diag dirs used to exercise the glob-expansion path.
// The real patterns live in githubWellKnownDiagnosticDirPatternsUnix/Win; these
// are the paths that globSync is made to "expand" to in tests.
const HOSTED_SAAS_DIAG_DIR_UNIX = '/home/runner/actions-runner/cached/2.334.0/_diag'
const HOSTED_SAAS_DIAG_DIR_WIN = 'C:/actions-runner/cached/2.334.0/_diag'

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

    process.env = {
      GITLAB_CI: 'true',
      CI_PIPELINE_ID: 'build-id',
      CI_JOB_ID: '10',
      CI_PROJECT_URL: 'url',
      CI_JOB_STAGE: 'test',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {CI_PIPELINE_ID: 'build-id', CI_JOB_ID: '10', CI_PROJECT_URL: 'url', CI_JOB_STAGE: 'test'},
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

    // DD_CUSTOM_STAGE_ID is optional (allowed to be missing)
    process.env = {
      JENKINS_URL: 'something',
      DD_CUSTOM_PARENT_ID: 'span-id',
      DD_CUSTOM_TRACE_ID: 'trace-id',
      DD_CUSTOM_STAGE_ID: 'stage-id',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {DD_CUSTOM_PARENT_ID: 'span-id', DD_CUSTOM_TRACE_ID: 'trace-id', DD_CUSTOM_STAGE_ID: 'stage-id'},
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

  test('github', () => {
    process.env = {GITHUB_ACTIONS: 'true'}
    expect(() => {
      getCIEnv()
    }).toThrow()

    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'build',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'build',
      },
      provider: 'github',
    })

    // DD_GITHUB_JOB_NAME is optional (allowed to be missing)
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '1',
      GITHUB_JOB: 'build',
      DD_GITHUB_JOB_NAME: 'my-job',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'build',
        DD_GITHUB_JOB_NAME: 'my-job',
      },
      provider: 'github',
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
      SYSTEM_STAGENAME: 'Build',
      SYSTEM_STAGEATTEMPT: '1',
    }
    expect(getCIEnv()).toEqual({
      ciEnv: {
        SYSTEM_TEAMPROJECTID: 'project-id',
        BUILD_BUILDID: '55',
        SYSTEM_JOBID: 'job-id',
        SYSTEM_STAGENAME: 'Build',
        SYSTEM_STAGEATTEMPT: '1',
      },
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
    // Default: SaaS patterns expand to the synthetic hosted dirs; everything
    // else expands to nothing. Individual tests can override.
    mockedGlobSync.mockImplementation((pattern: string) => {
      if (githubWellKnownDiagnosticDirPatternsUnix.includes(pattern)) {
        return [HOSTED_SAAS_DIAG_DIR_UNIX]
      }
      if (githubWellKnownDiagnosticDirPatternsWin.includes(pattern)) {
        return [HOSTED_SAAS_DIAG_DIR_WIN]
      }

      return []
    })
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

  // Variant with system.orchestrationId variable — reflects real runner log format.
  // ACTIONS_ORCHESTRATION_ID is sourced from this variable, so they always share the same value.
  const sampleLogContentWithOrchestrationId = (jobDisplayName: string, orchestrationId: string): string => `
    [2025-09-15 10:14:00Z INFO Worker] Waiting to receive the job message from the channel.
    [2025-09-15 10:14:00Z INFO ProcessChannel] Receiving message of length 22985, with hash 'abcdef'
    [2025-09-15 10:14:00Z INFO Worker] Message received.
    [2025-09-15 10:14:00Z INFO Worker] Job message:
    {
      "jobId": "95a4619c-e316-542f-8a21-74cd5a8ac9ca",
      "jobDisplayName": ${JSON.stringify(jobDisplayName)},
      "jobName": "__default",
      "variables": {
        "system.orchestrationId": {
          "value": "${orchestrationId}",
          "isSecret": false
        }
      }
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
    const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX // SaaS directory
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name (self-hosted)', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[0] // self-hosted directory
    const logContent = sampleLogContent(sampleJobDisplayName)

    mockReaddirSync(targetDir, sampleLogFileName)
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

    const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

    expect(jobName).toBe(sampleJobDisplayName)
    expect(mockedFs.readdirSync).toHaveBeenCalledWith(targetDir, {withFileTypes: true})
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(`${targetDir}/${sampleLogFileName}`, 'utf-8')
  })

  test('should find and return the job display name in opt directory', () => {
    const targetDir = githubWellKnownDiagnosticDirsUnix[1]
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
    const targetDir = HOSTED_SAAS_DIAG_DIR_WIN
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
    const targetDir = githubWellKnownDiagnosticDirsWin[0]
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

  describe.each([
    ['diag dir', '_diag'],
    ['cached diag dir', 'cached', '_diag'],
    ['actions-runner cached diag dir', 'actions-runner', 'cached', '_diag'],
    ['actions-runner diag dir', 'actions-runner', '_diag'],
  ])('should derive and try the %s from RUNNER_TEMP', (_description, ...routeParts) => {
    beforeEach(() => {
      const runnerTemp = '/home/actions/actions-runner/_work/_temp'
      process.env.RUNNER_TEMP = runnerTemp
      const runnerRoot = upath.resolve(runnerTemp, '..', '..')
      const derivedDiagDir = upath.join(runnerRoot, ...routeParts)
      const logContent = sampleLogContent(sampleJobDisplayName)

      // The `cached/**/_diag` globs emitted by getGithubDiagnosticDirsFromEnv
      // are the only way `cached` paths are reached now, so expand them to the
      // test's target when the route includes `cached`.
      const cachedPatterns = new Set([
        `${runnerRoot}/cached/**/_diag`,
        `${runnerRoot}/actions-runner/cached/**/_diag`,
        ...githubWellKnownDiagnosticDirPatternsUnix,
        ...githubWellKnownDiagnosticDirPatternsWin,
      ])
      mockedGlobSync.mockImplementation((pattern: string) => {
        if (routeParts.includes('cached') && cachedPatterns.has(pattern)) {
          return [derivedDiagDir]
        }

        return []
      })

      mockReaddirSync(derivedDiagDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)
    })

    test('and read the GitHub job display name from logs', () => {
      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)
      expect(jobName).toBe(sampleJobDisplayName)
    })
  })

  test('log files found but none contain the display name', () => {
    const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with multiple quotes', () => {
      const jobName = 'Test "foo" and "bar"'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse complex job name with quotes and special chars', () => {
      const jobName = 'End-to-End Tests (@org/backend, "features/a*", apps/backend)'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with regex patterns', () => {
      const jobName = 'Regex \\\\d+ test'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with literal escape sequences', () => {
      const jobName = 'Literal \\\\n and \\\\t'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse matrix job with quotes', () => {
      const jobName = 'Test (macos, "3.9")'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with multiple levels', () => {
      const jobName = 'CI / CD / Deploy'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Chinese characters', () => {
      const jobName = '测试任务'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Japanese characters', () => {
      const jobName = 'テストジョブ'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Arabic characters', () => {
      const jobName = 'اختبار العمل'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with Cyrillic characters', () => {
      const jobName = 'Тестовое задание'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })

    test('should parse job name with symbols', () => {
      const jobName = 'Build @scope/package #123'
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
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
      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      const logContent = sampleLogContent(jobName)

      mockReaddirSync(targetDir, sampleLogFileName)
      jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)

      const result = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(result).toBe(jobName)
    })
  })

  describe('Worker log identification with ACTIONS_ORCHESTRATION_ID', () => {
    // ACTIONS_ORCHESTRATION_ID is set by the runner (>= v2.331.0, feature-flag gated) from the
    // system.orchestrationId variable in the job message. The runner serializes that variable
    // into the Worker log, so matching the full value is a unique-per-job identifier.
    // When ACTIONS_ORCHESTRATION_ID is not set (older runners), we fall back to the original
    // behavior: return all logs and iterate until jobDisplayName is found.
    //
    // Value format (server-generated, opaque to the runner):
    //   Non-matrix job:        <planId>.<yaml-job-key>.__default
    //     e.g. 9f25551c-ce16-4f8f-a662-8575df3d1354.build-and-test.__default
    //   Single-dimension matrix: <planId>.<yaml-job-key>.<matrix-value>
    //     e.g. 9f25551c-ce16-4f8f-a662-8575df3d1354.build-and-test.22
    //   Multi-dimension matrix: <planId>.<yaml-job-key>.<val1>.<val2>[...]
    //     e.g. 9f25551c-ce16-4f8f-a662-8575df3d1354.test.ubuntu-22.04.20
    //
    // planId is a GUID that is shared across all jobs in the same workflow run. It is NOT
    // unique per job, which is why we match on the full orchestration ID rather than planId alone.

    test('should find the correct Worker log via system.orchestrationId', () => {
      // Non-matrix job format: <planId>.<yaml-job-key>.__default
      const orchestrationId = '9f25551c-ce16-4f8f-a662-8575df3d1354.build-and-test.__default'
      const originalEnv = process.env
      process.env = {...originalEnv, ACTIONS_ORCHESTRATION_ID: orchestrationId}

      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX
      mockReaddirSync(targetDir, 'Worker_20251014-083000.log')
      jest
        .spyOn(fs, 'readFileSync')
        .mockReturnValue(sampleLogContentWithOrchestrationId('correct-job-name', orchestrationId))

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      expect(jobName).toBe('correct-job-name')
      process.env = originalEnv
    })

    test('should check logs newest-first when ACTIONS_ORCHESTRATION_ID is not set (runner < v2.331.0)', () => {
      // Runners older than v2.331.0 (or without the feature flag) do not set ACTIONS_ORCHESTRATION_ID.
      // On a multi-runner, multiple Worker logs exist. Iterating newest-first ensures the current
      // job's log (most recent) is found first.
      const originalEnv = process.env
      process.env = {...originalEnv}
      delete process.env.ACTIONS_ORCHESTRATION_ID

      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX

      jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
        if (String(pathToRead) === String(targetDir)) {
          return [
            mockLogFileDirent('Worker_20251014-083000.log'), // previous job (older timestamp)
            mockLogFileDirent('Worker_20251014-090000.log'), // current job (newer timestamp)
          ]
        }
        throw getNotFoundFsError()
      })

      jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
        const filePathStr = String(filePath)
        if (filePathStr.includes('Worker_20251014-083000.log')) {
          return sampleLogContent('previous-job-name')
        }
        if (filePathStr.includes('Worker_20251014-090000.log')) {
          return sampleLogContent('current-job-name')
        }

        return ''
      })

      const jobName = getGithubJobNameFromLogs(createMockContext() as BaseContext)

      // The newest log (090000) is the current job's log and must be returned first
      expect(jobName).toBe('current-job-name')
      process.env = originalEnv
    })

    test('should check logs newest-first when system.orchestrationId is not found in any log', () => {
      // ACTIONS_ORCHESTRATION_ID is set but system.orchestrationId is absent from all logs
      // (e.g., a runner that sets the env var but does not yet write it to the log).
      // We emit a warning and fall back to newest-first iteration so multi-runners still
      // pick the current job's log correctly.
      // Non-matrix format: <planId>.<yaml-job-key>.__default
      const orchestrationId = '9f25551c-ce16-4f8f-a662-8575df3d1354.build-and-test.__default'
      const originalEnv = process.env
      process.env = {...originalEnv, ACTIONS_ORCHESTRATION_ID: orchestrationId}

      const targetDir = HOSTED_SAAS_DIAG_DIR_UNIX

      jest.spyOn(fs, 'readdirSync').mockImplementation((pathToRead) => {
        if (String(pathToRead) === String(targetDir)) {
          return [
            mockLogFileDirent('Worker_20251014-083000.log'), // previous job (older timestamp)
            mockLogFileDirent('Worker_20251014-090000.log'), // current job (newer timestamp)
          ]
        }
        throw getNotFoundFsError()
      })

      jest.spyOn(fs, 'readFileSync').mockImplementation((filePath: any) => {
        const filePathStr = String(filePath)
        // Neither log contains system.orchestrationId
        if (filePathStr.includes('Worker_20251014-083000.log')) {
          return sampleLogContent('previous-job-name')
        }
        if (filePathStr.includes('Worker_20251014-090000.log')) {
          return sampleLogContent('current-job-name')
        }

        return ''
      })

      const context = createMockContext() as BaseContext
      const jobName = getGithubJobNameFromLogs(context)

      expect(jobName).toBe('current-job-name')
      expect(context.stderr.toString()).toContain('Could not find Worker log via system.orchestrationId')
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

describe('getGithubStepInfoFromLogs', () => {
  const makeLogContent = (jobMessage: object) =>
    `[2025-09-15 10:14:00Z INFO Worker] Job message:\n${JSON.stringify(jobMessage)}`

  const mockDiagDir = (logContent: string) => {
    jest.spyOn(fs, 'readdirSync').mockReturnValue([
      {
        name: 'Worker_1.log' as any,
        isFile: () => true,
        isDirectory: () => false,
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        parentPath: '',
        path: '',
      },
    ])
    jest.spyOn(fs, 'readFileSync').mockReturnValue(logContent)
  }

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('returns step info when GITHUB_ACTION matches a contextName', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run_2',
    }
    const logContent = makeLogContent({
      jobDisplayName: 'build-and-test',
      steps: [{contextName: '__checkout'}, {contextName: '__run'}, {contextName: '__run_2'}, {contextName: '__run_3'}],
    })
    mockDiagDir(logContent)

    const result = getGithubStepInfoFromLogs(createMockContext() as BaseContext)
    expect(result).toEqual({jobDisplayName: 'build-and-test', stepIndex: 2})
  })

  test('returns stepIndex 0 when matching first step', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run',
    }
    const logContent = makeLogContent({
      jobDisplayName: 'my-job',
      steps: [{contextName: '__run'}, {contextName: '__run_2'}],
    })
    mockDiagDir(logContent)

    const result = getGithubStepInfoFromLogs(createMockContext() as BaseContext)
    expect(result).toEqual({jobDisplayName: 'my-job', stepIndex: 0})
  })

  test('throws when GITHUB_ACTION does not match any step', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run_99',
    }
    const logContent = makeLogContent({
      jobDisplayName: 'my-job',
      steps: [{contextName: '__run'}, {contextName: '__run_2'}],
    })
    mockDiagDir(logContent)

    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'Could not find step info in GitHub diagnostic logs'
    )
  })

  test('throws when steps array is missing', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run',
    }
    const logContent = makeLogContent({
      jobDisplayName: 'my-job',
    })
    mockDiagDir(logContent)

    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'Could not find step info in GitHub diagnostic logs'
    )
  })

  test('throws when not GitHub provider', () => {
    process.env = {
      CIRCLECI: 'true',
      GITHUB_ACTION: '__run',
    }

    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'Step level is only supported for GitHub Actions'
    )
  })

  test('throws when GITHUB_ACTION is not set', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
    }

    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'GITHUB_ACTION environment variable is not set'
    )
  })

  test('throws for malformed JSON in log', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run',
    }
    mockDiagDir('[2025-09-15 10:14:00Z INFO Worker] Job message:\n{not valid json')

    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'Could not find step info in GitHub diagnostic logs'
    )
  })

  test('correctly parses pretty-printed Job message with nested objects in steps', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__run_2',
    }
    // Realistic log with pretty-printed JSON, nested objects in steps, and
    // surrounding log lines that could contain misleading matches
    const logContent = [
      '[2025-09-15 10:14:00Z INFO Worker] Waiting to receive the job message from the channel.',
      '[2025-09-15 10:14:00Z INFO Worker] Message received.',
      '[2025-09-15 10:14:00Z INFO Worker] Job message:',
      ' {',
      '  "jobDisplayName": "build-and-test",',
      '  "steps": [',
      '    {',
      '      "type": "action",',
      '      "reference": { "type": "repository", "name": "actions/checkout" },',
      '      "contextName": "__actions_checkout",',
      '      "id": "step-1"',
      '    },',
      '    {',
      '      "type": "action",',
      '      "reference": { "type": "script" },',
      '      "displayNameToken": { "lit": "Run step 1" },',
      '      "contextName": "__run",',
      '      "inputs": { "type": 2, "map": [{ "key": "script", "value": { "lit": "echo hello" } }] },',
      '      "id": "step-2"',
      '    },',
      '    {',
      '      "type": "action",',
      '      "reference": { "type": "script" },',
      '      "contextName": "__run_2",',
      '      "id": "step-3"',
      '    }',
      '  ],',
      '  "variables": { "system.github.job": { "value": "build" } },',
      '  "contextData": { "github": { "t": 2 } }',
      ' }',
      '[2025-09-15 10:14:00Z INFO ExecutionContext] Publish step telemetry for current step {',
      '  "stepContextName": "__actions_checkout"',
      '}.',
    ].join('\n')
    mockDiagDir(logContent)

    const result = getGithubStepInfoFromLogs(createMockContext() as BaseContext)
    expect(result).toEqual({jobDisplayName: 'build-and-test', stepIndex: 2})
  })

  test('ignores contextName outside of Job message steps array', () => {
    process.env = {
      GITHUB_ACTIONS: 'true',
      GITHUB_ACTION: '__actions_checkout',
    }
    // The telemetry after the Job message also contains stepContextName,
    // but the steps array does NOT contain __actions_checkout
    const logContent = [
      '[2025-09-15 10:14:00Z INFO Worker] Job message:',
      ' {',
      '  "jobDisplayName": "my-job",',
      '  "steps": [',
      '    { "contextName": "__run", "id": "step-1" }',
      '  ]',
      ' }',
      '[2025-09-15 10:14:00Z INFO ExecutionContext] stepContextName: "__actions_checkout"',
    ].join('\n')
    mockDiagDir(logContent)

    // Should NOT match __actions_checkout from the telemetry line — should throw instead
    expect(() => getGithubStepInfoFromLogs(createMockContext() as BaseContext)).toThrow(
      'Could not find step info in GitHub diagnostic logs'
    )
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
