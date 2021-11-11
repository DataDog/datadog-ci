/* tslint:disable:no-string-literal */
import {
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  EXTENSION_LAYER_KEY,
  EXTRA_TAGS_REG_EXP,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LAMBDA_HANDLER_ENV_VAR,
  MERGE_XRAY_TRACES_ENV_VAR,
  Runtime,
  RUNTIME_LAYER_LOOKUP,
  TRACE_ENABLED_ENV_VAR,
} from '../../constants'
import {
  addLayerArn,
  collectFunctionsByRegion,
  getLayerArn,
  getRegion,
  sentenceMatchesRegEx,
  updateLambdaFunctionConfigs,
} from '../../functions/commons'
import {InstrumentCommand} from '../../instrument'
import {createCommand, makeMockCloudWatchLogs, makeMockLambda, mockAwsAccount} from '../fixtures'

describe('commons', () => {
  describe('addLayerArn', () => {
    test('adds layers and removes previous versions', () => {
      const runtime: Runtime = 'python3.9'
      const config = {
        Runtime: runtime,
      }
      let layerARNs = [
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Python39:48',
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:10',
      ]
      const region = 'sa-east-1'
      const lambdaLibraryLayerName = RUNTIME_LAYER_LOOKUP[runtime]
      const fullLambdaLibraryLayerArn = getLayerArn(config, config.Runtime, region) + ':49'
      const fullExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as Runtime, region) + ':11'
      layerARNs = addLayerArn(fullLambdaLibraryLayerArn, lambdaLibraryLayerName, layerARNs)
      layerARNs = addLayerArn(fullExtensionLayerArn, DD_LAMBDA_EXTENSION_LAYER_NAME, layerARNs)

      expect(layerARNs).toEqual([
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Python39:49',
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:11',
      ])
    })

    test('swaps layers if architecture is arm64', () => {
      const runtime: Runtime = 'python3.9'
      const config = {
        Architectures: ['arm64'],
        Runtime: runtime,
      }
      let layerARNs = [
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Python39:49',
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:11',
      ]
      const region = 'sa-east-1'
      const lambdaLibraryLayerName = RUNTIME_LAYER_LOOKUP[runtime]
      const fullLambdaLibraryLayerArn = getLayerArn(config, config.Runtime, region) + ':49'
      const fullExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as Runtime, region) + ':11'
      layerARNs = addLayerArn(fullLambdaLibraryLayerArn, lambdaLibraryLayerName, layerARNs)
      layerARNs = addLayerArn(fullExtensionLayerArn, DD_LAMBDA_EXTENSION_LAYER_NAME, layerARNs)

      expect(layerARNs).toEqual([
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Python39-ARM:49',
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension-ARM:11',
      ])
    })
  })
  describe('collectFunctionsByRegion', () => {
    test('groups functions with region read from arn', () => {
      process.env = {}
      const command = createCommand(InstrumentCommand)
      const region = 'us-east-1'
      command['functions'] = [
        'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        'arn:aws:lambda:us-east-1:123456789012:function:another',
        'arn:aws:lambda:us-east-2:123456789012:function:third-func',
      ]

      expect(collectFunctionsByRegion(command['functions'], region)).toEqual({
        'us-east-1': [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:us-east-1:123456789012:function:another',
        ],
        'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
      })
    })

    test('groups functions in the config object', () => {
      process.env = {}
      const command = createCommand(InstrumentCommand)
      const region = 'us-east-1'
      command['config']['functions'] = [
        'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        'arn:aws:lambda:us-east-1:123456789012:function:another',
        'arn:aws:lambda:us-east-2:123456789012:function:third-func',
      ]

      expect(collectFunctionsByRegion(command['config']['functions'], region)).toEqual({
        'us-east-1': [
          'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          'arn:aws:lambda:us-east-1:123456789012:function:another',
        ],
        'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
      })
    })

    test('uses default region for functions not in arn format', () => {
      process.env = {}
      const command = createCommand(InstrumentCommand)
      command['functions'] = [
        'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        'arn:aws:lambda:*:123456789012:function:func-with-wildcard',
        'func-without-region',
        'arn:aws:lambda:us-east-2:123456789012:function:third-func',
      ]
      command['region'] = 'ap-south-1'

      expect(collectFunctionsByRegion(command['functions'], command['region'])).toEqual({
        'ap-south-1': ['arn:aws:lambda:*:123456789012:function:func-with-wildcard', 'func-without-region'],
        'us-east-1': ['arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'],
        'us-east-2': ['arn:aws:lambda:us-east-2:123456789012:function:third-func'],
      })
    })

    test('fails to collect when there are regionless functions and no default region is set', () => {
      process.env = {}
      const command = createCommand(InstrumentCommand)
      command['functions'] = [
        'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        'arn:aws:lambda:*:123456789012:function:func-with-wildcard',
        'func-without-region',
        'arn:aws:lambda:us-east-2:123456789012:function:third-func',
      ]
      command['region'] = undefined
      command['config']['region'] = undefined
      let functionsGroup
      try {
        functionsGroup = collectFunctionsByRegion(command['functions'], command['region'])
      } catch (err) {
        // Do nothing
      }
      expect(functionsGroup).toBeUndefined()
    })
  })
  describe('getLayerArn', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('gets sa-east-1 Lambda Extension layer ARN', async () => {
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Extension`)
    })

    test('gets sa-east-1 arm64 Lambda Extension layer ARN', async () => {
      const config = {
        Architectures: ['arm64'],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn(config, EXTENSION_LAYER_KEY as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Extension-ARM`)
    })

    test('gets us-gov-1 gov cloud Lambda Extension layer ARN', async () => {
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`)
    })

    test('gets us-gov-1 gov cloud arm64 Lambda Extension layer ARN', async () => {
      const config = {
        Architectures: ['arm64'],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, EXTENSION_LAYER_KEY as Runtime, region, settings)
      expect(layerArn).toEqual(
        `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension-ARM`
      )
    })

    test('gets sa-east-1 Node12 Lambda Library layer ARN', async () => {
      const runtime = 'nodejs12.x'
      const config = {
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn(config, config.Runtime as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Node12-x`)
    })

    test('gets sa-east-1 Python3.9 arm64 Lambda Library layer ARN', async () => {
      const runtime = 'python3.9'
      const config = {
        Architectures: ['arm64'],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn(config, config.Runtime as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Python39-ARM`)
    })
    test('gets us-gov-1 Python37 gov cloud Lambda Library layer ARN', async () => {
      const runtime = 'python3.7'
      const config = {
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, config.Runtime as Runtime, region, settings)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python37`)
    })
    test('gets us-gov-1 Python39 gov cloud arm64 Lambda Library layer ARN', async () => {
      const runtime = 'python3.9'
      const config = {
        Architectures: ['arm64'],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, config.Runtime as Runtime, region, settings)
      expect(layerArn).toEqual(
        `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python39-ARM`
      )
    })
  })
  describe('getRegion', () => {
    test('should return the expected region', () => {
      const functionARN = 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world'
      const expectedRegion = 'us-east-1'

      const region = getRegion(functionARN)
      expect(region).toBe(expectedRegion)
    })

    test('should return undefined if Function ARN does not contain the region', () => {
      const functionName = 'lambda-hello-world'

      const region = getRegion(functionName)
      expect(region).toBe(undefined)
    })
  })
  describe('sentenceMatchesRegEx', () => {
    const tags: [string, boolean][] = [
      ['not-complying:regex-should-fail', false],
      ['1first-char-is-number:should-fail', false],
      ['_also-not-complying:should-fail', false],
      ['complying_tag:accepted/with/slashes.and.dots,but-empty-tag', false],
      ['also_complying:success,1but_is_illegal:should-fail', false],
      ['this:complies,also_this_one:yes,numb3r_in_name:should-succeed,dots:al.lo.wed', true],
      ['complying_ip_address_4:192.342.3134.231', true],
      ['complying:alone', true],
      ['one_divided_by_two:1/2,one_divided_by_four:0.25,three_minus_one_half:3-1/2', true],
      ['this_is_a_valid_t4g:yes/it.is-42', true],
    ]
    test.each(tags)('check if the tags match the expected result from the regex', (tag, expectedResult) => {
      const result = !!sentenceMatchesRegEx(tag, EXTRA_TAGS_REG_EXP)
      expect(result).toEqual(expectedResult)
    })
  })

  describe('updateLambdaConfigs', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('updates every lambda', async () => {
      const lambda = makeMockLambda({})
      const configs = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
          lambdaLibraryLayerArn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x',
          updateRequest: {
            Environment: {
              Variables: {
                [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [TRACE_ENABLED_ENV_VAR]: 'false',
              },
            },
            FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'],
          },
        },
      ]
      const cloudWatch = makeMockCloudWatchLogs({})

      await updateLambdaFunctionConfigs(lambda as any, cloudWatch as any, configs)
      expect(lambda.updateFunctionConfiguration).toHaveBeenCalledWith({
        Environment: {
          Variables: {
            [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
            [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
            [TRACE_ENABLED_ENV_VAR]: 'false',
          },
        },
        FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
        Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node12-x:22'],
      })
    })
  })
})
