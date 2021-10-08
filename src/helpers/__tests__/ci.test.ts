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

  const spanTagsToMetadata = (tags: SpanTags): Metadata => {
    const metadata: Metadata = {
      ci: {job: {}, pipeline: {}, provider: {}, stage: {}},
      git: {commit: {author: {}, committer: {}}},
    }
    Object.entries(tags).forEach(([tag, value]) => {
      // Set metadata nested properties from tag
      const properties = tag.split('.') // ['git', 'commit', 'author', 'name']
      let metadataAttribute: {[k: string]: any} = metadata // Current attribute up to second to last
      for (let i = 0; i < properties.length - 1; i++) {
        metadataAttribute = metadataAttribute[properties[i]]
      }
      metadataAttribute[properties[properties.length - 1]] = value
    })

    return metadata
  }

  describe.each(CI_PROVIDERS)('%s', (ciProvider) => {
    const assertions = require(path.join(__dirname, 'ci-env', ciProvider))

    test.each(assertions)('spec %#', (env, tags: SpanTags) => {
      process.env = env

      const expectedMetadata = spanTagsToMetadata(tags)
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
