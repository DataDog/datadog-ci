import fs from 'fs'

import upath from 'upath'

import {getCIEnv, getCIMetadata, getCISpanTags, isInteractive} from '../ci'
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

const CI_PROVIDERS = fs.readdirSync(upath.join(__dirname, 'ci-env'))

const ddMetadataToSpanTags = (ddMetadata: {[key: string]: string}): SpanTags => {
  const spanTags: SpanTags = {}
  Object.entries(ddMetadata).map(([key, value]) => {
    let tagKey = key.split('_').slice(1).join('.').toLocaleLowerCase() // Split and remove DD prefix

    if (tagKey === 'git.repository.url') {
      tagKey = 'git.repository_url'
    } else if (tagKey === 'git.commit.head.sha') {
      tagKey = 'git.commit.head_sha'
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
      {[tag: string]: string}
    ][]

    test.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = env

      expect(getTags()).toEqual(tags)
    })
  })

  describe.each(CI_PROVIDERS)('Ensure DD env variables override %s env variables', (ciProvider) => {
    const DD_METADATA = {
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
      {[tag: string]: string}
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
      {[key: string]: string}
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

const getTags = (): SpanTags => {
  return {
    ...getCISpanTags(),
    ...getUserCISpanTags(),
    ...getUserGitSpanTags(),
  }
}
