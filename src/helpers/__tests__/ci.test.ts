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

    assertions.forEach(
      ([env, expectedSpanTags]: [{[key: string]: string}, {[key: string]: string | number}], index: number) => {
        test(`reads env info for spec ${index} from ${ciProvider}`, () => {
          process.env = env
          const tags = {
            ...getCISpanTags(),
            ...getUserGitMetadata(),
          }
          expect(tags).toEqual(expectedSpanTags)
        })
      }
    )
  })
})

const ciAppTagsToMetadata = (tags: SpanTags): Metadata => {
  const metadata: Metadata = {
    ci: {job: {}, pipeline: {}, provider: {}, stage: {}},
    git: {commit: {author: {}, committer: {}}},
  }

  Object.entries(tags).forEach(([tag, value]) => {
    if (!value) {
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
    currentAttr[attributeName] = attributeName === 'number' ? parseInt(value, 10) : value
  })

  return metadata
}
