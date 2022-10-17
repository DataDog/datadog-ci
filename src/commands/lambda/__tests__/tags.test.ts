jest.mock('../loggroup')
import path from 'path'

import {Lambda} from 'aws-sdk'
import {TAG_VERSION_NAME} from '../constants'
import {applyTagConfig, calculateTagRemoveRequest, calculateTagUpdateRequest, hasVersionTag} from '../tags'
const {version} = require(path.join(__dirname, '../../../../package.json'))

const makeMockLambda = (
  functions: Record<string, {config: Lambda.FunctionConfiguration; tagsResponse?: Lambda.ListTagsResponse}>
) => ({
  listTags: jest.fn().mockImplementation(({Resource}: Lambda.ListTagsRequest) => {
    const tags = functions[Resource]?.tagsResponse ?? {Tags: {}}

    return {
      promise: () => Promise.resolve(tags),
    }
  }),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

const VERSION_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/

describe('tags', () => {
  describe('applyTagConfig', () => {
    test('Calls tagResource with config data', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })
      const config = {
        tagResourceRequest: {
          Resource: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Tags: {
            dd_sls_ci: 'v0.0.0',
          },
        },
      }
      const result = await applyTagConfig(lambda as any, config)
      expect(result).toEqual(undefined)
      expect(lambda.tagResource).toHaveBeenCalledWith(config.tagResourceRequest)
    })
    test('Handles undefined config', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })
      const config = {
        tagResourceRequest: undefined,
      }
      const result = await applyTagConfig(lambda as any, config)
      expect(result).toEqual(undefined)
      expect(lambda.tagResource).not.toHaveBeenCalled()
    })
  })
  describe('calculateTagUpdateRequest', () => {
    test('Handles no existing tags', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })
      const result = await calculateTagUpdateRequest(lambda as any, functionARN)
      expect(result).toEqual({
        tagResourceRequest: {
          Resource: functionARN,
          Tags: {
            dd_sls_ci: expect.stringMatching(VERSION_REGEX),
          },
        },
      })
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('Handles different version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {dd_sls_ci: 'v0.0.0'}})}))

      const result = await calculateTagUpdateRequest(lambda as any, functionARN)
      expect(result).toEqual({
        tagResourceRequest: {
          Resource: functionARN,
          Tags: {
            dd_sls_ci: expect.stringMatching(VERSION_REGEX),
          },
        },
      })
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('Handles sam version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {dd_sls_ci: `v${version}`}})}))

      const result = await calculateTagUpdateRequest(lambda as any, functionARN)
      expect(result).toBe(undefined)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
  })
  describe('calculateTagRemoveRequest', () => {
    test('returns untag resource configuration with the keys to delete', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          tagsResponse: {
            Tags: {dd_sls_ci: `v${version}`},
          },
        },
      })
      const result = await calculateTagRemoveRequest(lambda as any, functionARN)
      expect(result).toMatchInlineSnapshot(`
        Object {
          "untagResourceRequest": Object {
            "Resource": "${functionARN}",
            "TagKeys": Array [
              "${TAG_VERSION_NAME}",
            ],
          },
        }
      `)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })

    test('returns undefined when no tags need to be removed', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          tagsResponse: {
            Tags: {not_datadog: 'some-tag'},
          },
        },
      })
      const result = await calculateTagRemoveRequest(lambda as any, functionARN)
      expect(result).toBeUndefined()
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
  })
  describe('hasVersionTag', () => {
    test('handles no tags', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })

      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(false)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('handles no version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {foo: 'bar'}})}))

      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(false)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('handles different version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          tagsResponse: {
            Tags: {dd_sls_ci: 'v0.0.0'},
          },
        },
      })
      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(false)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('handles same version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          config: {
            FunctionArn: functionARN,
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          tagsResponse: {
            Tags: {dd_sls_ci: `v${version}`},
          },
        },
      })
      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(true)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
  })
})
