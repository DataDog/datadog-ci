import fs from 'fs'
import path from 'path'

import {getCIMetadata, getCISpanTags} from '../ci'
import {Metadata, SpanTags} from '../interfaces'
import {getUserGitMetadata} from '../user-provided-git'

const CI_PROVIDERS = fs.readdirSync(path.join(__dirname, 'ci-env'))

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

  describe.each(CI_PROVIDERS)('%s', (ciProvider) => {
    const assertions = require(path.join(__dirname, 'ci-env', ciProvider))

    test.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = env

      const expectedMetadata = ciAppTagsToMetadata(tags)
      expect(getCIMetadata()).toEqual(expectedMetadata)
    })
  })
})

describe('ci spec', () => {
  test('returns an empty object if the CI is not supported', () => {
    process.env = {}
    const tags = {
      ...getCISpanTags(),
      ...getUserGitMetadata(),
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
          ...getUserGitMetadata(),
        }
        expect(tags).toEqual(expectedSpanTags)
      })
    })
  })
})

const ciAppTagsToMetadata = (tags: SpanTags): Metadata => {
  const metadata: Metadata = {
    ci: {job: {}, pipeline: {}, provider: {}, stage: {}},
    git: {commit: {author: {}, committer: {}}},
  }

  Object.entries(tags).forEach(([tag, value]) => {
    // Ignore JSON fixtures pipeline number that can't be parsed to numbers
    if (!value || tag === 'ci.pipeline.number') {
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
