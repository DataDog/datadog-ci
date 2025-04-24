jest.mock('../loggroup')
jest.mock('../../../../package.json', () => ({version: 'XXXX'}))

import {
  LambdaClient,
  ListTagsCommand,
  TagResourceCommand,
  TagResourceCommandInput,
  UntagResourceCommand,
  UntagResourceCommandInput,
} from '@aws-sdk/client-lambda'
import {mockClient} from 'aws-sdk-client-mock'
import 'aws-sdk-client-mock-jest'

import {TAG_VERSION_NAME} from '../constants'
import {TagConfiguration} from '../interfaces'
import {
  applyTagConfig,
  calculateTagRemoveRequest,
  calculateTagUpdateRequest,
  hasVersionTag,
  tagResource,
  untagResource,
} from '../tags'

import {mockLambdaClientCommands, mockLambdaConfigurations} from './fixtures'

describe('tags', () => {
  const lambdaClientMock = mockClient(LambdaClient)

  beforeEach(() => {
    lambdaClientMock.reset()
    mockLambdaClientCommands(lambdaClientMock)
  })
  describe('applyTagConfig', () => {
    test('tags resources with config', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })
      const config: TagConfiguration = {
        tagResourceCommandInput: {
          Resource: functionArn,
          Tags: {
            [TAG_VERSION_NAME]: 'vXXXX',
          },
        },
      }
      await applyTagConfig(lambdaClientMock as any, config)
      expect(lambdaClientMock).toHaveReceivedCommandWith(TagResourceCommand, config.tagResourceCommandInput!)
    })

    test('doesnt tag resources when config is undefined', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })
      const config: TagConfiguration = {
        tagResourceCommandInput: undefined,
      }
      await applyTagConfig(lambdaClientMock as any, config)
      expect(lambdaClientMock).toHaveReceivedCommandTimes(TagResourceCommand, 0)
    })

    test('untags resources with config', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {
              [TAG_VERSION_NAME]: 'vXXXX',
            },
          },
        },
      })
      const config: TagConfiguration = {
        untagResourceCommandInput: {
          Resource: functionArn,
          TagKeys: [TAG_VERSION_NAME],
        },
      }
      await applyTagConfig(lambdaClientMock as any, config)
      expect(lambdaClientMock).toHaveReceivedCommandWith(UntagResourceCommand, config.untagResourceCommandInput!)
    })
  })
  describe('calculateTagUpdateRequest', () => {
    test('when no tags are present', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })
      const result = await calculateTagUpdateRequest(lambdaClientMock as any, functionArn)
      expect(result).toEqual({
        tagResourceCommandInput: {
          Resource: functionArn,
          Tags: {
            [TAG_VERSION_NAME]: 'vXXXX',
          },
        },
      })
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('Handles different version tag', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {
              [TAG_VERSION_NAME]: 'v0.0.0',
            },
          },
        },
      })

      const result = await calculateTagUpdateRequest(lambdaClientMock as any, functionArn)
      expect(result).toEqual({
        tagResourceCommandInput: {
          Resource: functionArn,
          Tags: {
            [TAG_VERSION_NAME]: 'vXXXX',
          },
        },
      })
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('Handles sam version tag', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {
              [TAG_VERSION_NAME]: 'vXXXX',
            },
          },
        },
      })

      await calculateTagUpdateRequest(lambdaClientMock as any, functionArn)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })
  })
  describe('calculateTagRemoveRequest', () => {
    test('returns untag resource configuration with the keys to delete', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {[TAG_VERSION_NAME]: 'vXXXX'},
          },
        },
      })
      const result = await calculateTagRemoveRequest(lambdaClientMock as any, functionArn)
      expect(result).toMatchInlineSnapshot(`
        {
          "untagResourceCommandInput": {
            "Resource": "${functionArn}",
            "TagKeys": [
              "${TAG_VERSION_NAME}",
            ],
          },
        }
      `)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('returns undefined when no tags need to be removed', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {not_datadog: 'some-tag'},
          },
        },
      })
      const result = await calculateTagRemoveRequest(lambdaClientMock as any, functionArn)
      expect(result).toBeUndefined()
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })
  })
  describe('hasVersionTag', () => {
    test('handles no tags', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
      })

      const result = await hasVersionTag(lambdaClientMock as any, functionArn)
      expect(result).toBe(false)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('handles no version tag', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {
              foo: 'bar',
            },
          },
        },
      })

      const result = await hasVersionTag(lambdaClientMock as any, functionArn)
      expect(result).toBe(false)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('handles different version tag', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {[TAG_VERSION_NAME]: 'v0.0.0'},
          },
        },
      })
      const result = await hasVersionTag(lambdaClientMock as any, functionArn)
      expect(result).toBe(false)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })

    test('handles same version tag', async () => {
      const functionArn = 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument'
      mockLambdaConfigurations(lambdaClientMock, {
        [functionArn]: {
          config: {
            FunctionArn: functionArn,
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
          tags: {
            Tags: {[TAG_VERSION_NAME]: 'vXXXX'},
          },
        },
      })
      const result = await hasVersionTag(lambdaClientMock as any, functionArn)
      expect(result).toBe(true)
      expect(lambdaClientMock).toHaveReceivedCommandWith(ListTagsCommand, {Resource: functionArn})
    })
  })
  describe('tagResource', () => {
    test('call is sent correctly', async () => {
      const input: TagResourceCommandInput = {
        Resource: 'some-arn',
        Tags: {
          foo: 'bar',
        },
      }
      await tagResource(lambdaClientMock as any, input)

      expect(lambdaClientMock).toHaveReceivedCommandWith(TagResourceCommand, input)
    })
  })

  describe('untagResource', () => {
    test('call is sent correctly', async () => {
      const input: UntagResourceCommandInput = {
        Resource: 'some-arn',
        TagKeys: ['foo'],
      }
      await untagResource(lambdaClientMock as any, input)

      expect(lambdaClientMock).toHaveReceivedCommandWith(UntagResourceCommand, input)
    })
  })
})
