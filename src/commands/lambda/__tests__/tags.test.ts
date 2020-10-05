jest.mock('../loggroup')
import path from 'path'

import {Lambda} from 'aws-sdk'
import {applyTagConfig, calculateTagUpdateRequest, hasVersionTag} from '../tags'
// tslint:disable-next-line
const {version} = require(path.join(__dirname, '../../../../package.json'))

const makeMockLambda = (functionConfigs: Record<string, Lambda.FunctionConfiguration>) => ({
  listTags: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve({Tags: {}})})),
  tagResource: jest.fn().mockImplementation(() => ({promise: () => Promise.resolve()})),
})

const VERSION_REGEX = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(\.(0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(\+[0-9a-zA-Z-]+(\.[0-9a-zA-Z-]+)*)?$/

describe('tags', () => {
  describe('applyTagConfig', () => {
    test('Calls tagResource with config data', async () => {
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {dd_sls_ci: `v${version}`}})}))

      const result = await calculateTagUpdateRequest(lambda as any, functionARN)
      expect(result).toBe(undefined)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
  })
  describe('hasVersionTag', () => {
    test('handles no tags', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
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
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {dd_sls_ci: 'v0.0.0'}})}))

      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(false)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
    test('handles same version tag', async () => {
      const functionARN = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      const lambda = makeMockLambda({
        'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument': {
          FunctionArn: functionARN,
          Handler: 'index.handler',
          Runtime: 'nodejs12.x',
        },
      })

      lambda.listTags.mockImplementation(() => ({promise: () => Promise.resolve({Tags: {dd_sls_ci: `v${version}`}})}))

      const result = await hasVersionTag(lambda as any, functionARN)
      expect(result).toBe(true)
      expect(lambda.listTags).toHaveBeenCalledWith({Resource: functionARN})
    })
  })
})
