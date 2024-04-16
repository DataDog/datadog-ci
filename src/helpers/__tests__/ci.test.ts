import fs from 'fs'
import path from 'path'

import {getCIEnv, getCIMetadata, getCISpanTags} from '../ci'
import {Metadata, SpanTags} from '../interfaces'
import {CI_NODE_LABELS, CI_ENV_VARS} from '../tags'
import {getUserCISpanTags, getUserGitSpanTags} from '../user-provided-git'

const CI_PROVIDERS = fs.readdirSync(path.join(__dirname, 'ci-env'))

const ciAppTagsToMetadata = (tags: SpanTags): Metadata => {
  const metadata: Metadata = {
    ci: {job: {}, pipeline: {}, provider: {}, stage: {}},
    git: {commit: {author: {}, committer: {}}},
  }

  Object.entries(tags).forEach(([tag, value]) => {
    // Ignore JSON fixtures pipeline number that can't be parsed to numbers
    if (
      !value ||
      tag === 'ci.pipeline.number' ||
      tag === '_dd.ci.env_vars' ||
      tag === 'ci.node.labels' ||
      tag === 'ci.node.name'
    ) {
      return
    }

    // Get Metadata nested property from tag name ('git.commit.author.name')
    let currentAttr: {[k: string]: any} = metadata
    // Current attribute up to second to last
    const properties = tag.split('.')
    for (let i = 0; i < properties.length - 1; i++) {
      currentAttr = currentAttr[properties[i]]
    }

    const attributeName = properties[properties.length - 1]
    currentAttr[attributeName] = value
  })

  return metadata
}

const ddMetadataToSpanTags = (ddMetadata: {[key: string]: string}): SpanTags => {
  const spanTags: SpanTags = {}
  Object.entries(ddMetadata).map(([key, value]) => {
    let tagKey = key.split('_').slice(1).join('.').toLocaleLowerCase() // Split and remove DD prefix

    if (tagKey === 'git.repository.url') {
      tagKey = 'git.repository_url'
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
    const assertions = require(path.join(__dirname, 'ci-env', ciProvider)) as [
      {[key: string]: string},
      {[tag: string]: string}
    ][]

    test.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = env

      const expectedMetadata = ciAppTagsToMetadata(tags)
      expect(getCIMetadata()).toEqual(expectedMetadata)
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
    }

    const expectedMetadata = ciAppTagsToMetadata(ddMetadataToSpanTags(DD_METADATA))
    delete expectedMetadata.git.branch

    const assertions = require(path.join(__dirname, 'ci-env', ciProvider)) as [
      {[key: string]: string},
      {[tag: string]: string}
    ][]

    it.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = {...env, ...DD_METADATA}
      const ciMetadata = getCIMetadata()
      delete ciMetadata?.git.branch
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
    const assertions = require(path.join(__dirname, 'ci-env', ciProvider))

    assertions.forEach(([env, expectedSpanTags]: [{[key: string]: string}, {[key: string]: string}], index: number) => {
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
    }).toThrow(
      'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
    )
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
