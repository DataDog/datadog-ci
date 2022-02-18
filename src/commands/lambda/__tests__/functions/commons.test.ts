/* tslint:disable:no-string-literal */
jest.mock('aws-sdk')
import {Lambda} from 'aws-sdk'
import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DEFAULT_LAYER_AWS_ACCOUNT,
  EXTENSION_LAYER_KEY,
  EXTRA_TAGS_REG_EXP,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LAMBDA_HANDLER_ENV_VAR,
  LAYER_LOOKUP,
  LayerKey,
  MERGE_XRAY_TRACES_ENV_VAR,
  Runtime,
  TRACE_ENABLED_ENV_VAR,
} from '../../constants'
import {
  addLayerArn,
  checkRuntimeTypesAreUniform,
  coerceBoolean,
  collectFunctionsByRegion,
  findLatestLayerVersion,
  getLayerArn,
  getLayerNameWithVersion,
  getRegion,
  isMissingAnyDatadogApiKeyEnvVar,
  isMissingAWSCredentials,
  isMissingDatadogEnvVars,
  isMissingDatadogSiteEnvVar,
  sentenceMatchesRegEx,
  updateLambdaFunctionConfigs,
} from '../../functions/commons'
import {InstrumentCommand} from '../../instrument'
import {FunctionConfiguration} from '../../interfaces'
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
      const lambdaLibraryLayerName = LAYER_LOOKUP[runtime]
      const fullLambdaLibraryLayerArn = getLayerArn(config, config.Runtime, region) + ':49'
      const fullExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region) + ':11'
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
      const lambdaLibraryLayerName = LAYER_LOOKUP[runtime]
      const fullLambdaLibraryLayerArn = getLayerArn(config, config.Runtime, region) + ':49'
      const fullExtensionLayerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region) + ':11'
      layerARNs = addLayerArn(fullLambdaLibraryLayerArn, lambdaLibraryLayerName, layerARNs)
      layerARNs = addLayerArn(fullExtensionLayerArn, DD_LAMBDA_EXTENSION_LAYER_NAME, layerARNs)

      expect(layerARNs).toEqual([
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Python39-ARM:49',
        'arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension-ARM:11',
      ])
    })
  })

  describe('coerceBoolean', () => {
    test('return fallback when none of the values provided can be parsed to boolean', () => {
      expect(coerceBoolean(true, 'NotBoolean', 123, [], {})).toBe(true)
      expect(coerceBoolean(false, 'NotBooleanEither', 456, ['An array'], {booleanInObject: true})).toBe(false)
    })

    test('return the first boolean when one of the values provided can be parsed to boolean', () => {
      expect(coerceBoolean(true, 'false', 'true')).toBe(false)
      expect(coerceBoolean(false, 'true', 'False')).toBe(true)
    })

    test('return the first boolean when one of the values provided is boolean', () => {
      expect(coerceBoolean(true, false, 'truE', true)).toBe(false)
      expect(coerceBoolean(false, true, 'False', false)).toBe(true)
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

  describe('findLatestLayerVersion', () => {
    test('finds latests version for Python39', async () => {
      const layer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Python39`
      ;(Lambda as any).mockImplementation(() =>
        makeMockLambda(
          {},
          {
            [`${layer}:1`]: {
              LayerVersionArn: `${layer}:1`,
              Version: 1,
            },
            [`${layer}:2`]: {
              LayerVersionArn: `${layer}:2`,
              Version: 2,
            },
            [`${layer}:10`]: {
              LayerVersionArn: `${layer}:10`,
              Version: 10,
            },
            [`${layer}:20`]: {
              LayerVersionArn: `${layer}:20`,
              Version: 20,
            },
            [`${layer}:30`]: {
              LayerVersionArn: `${layer}:30`,
              Version: 30,
            },
            [`${layer}:31`]: {
              LayerVersionArn: `${layer}:31`,
              Version: 31,
            },
            [`${layer}:32`]: {
              LayerVersionArn: `${layer}:32`,
              Version: 32,
            },
          }
        )
      )
      const runtime: Runtime = 'python3.9'
      const region = 'sa-east-1'
      const expectedLatestVersion = 32
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })

    test('finds latests version for Node14', async () => {
      const layer = `arn:aws:lambda:us-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node14-x`
      ;(Lambda as any).mockImplementation(() =>
        makeMockLambda(
          {},
          {
            [`${layer}:1`]: {
              LayerVersionArn: `${layer}:1`,
              Version: 1,
            },
            [`${layer}:10`]: {
              LayerVersionArn: `${layer}:10`,
              Version: 10,
            },
            [`${layer}:20`]: {
              LayerVersionArn: `${layer}:20`,
              Version: 20,
            },
            [`${layer}:30`]: {
              LayerVersionArn: `${layer}:30`,
              Version: 30,
            },
            [`${layer}:40`]: {
              LayerVersionArn: `${layer}:40`,
              Version: 40,
            },
            [`${layer}:41`]: {
              LayerVersionArn: `${layer}:41`,
              Version: 41,
            },
          }
        )
      )
      const runtime: Runtime = 'nodejs14.x'
      const region = 'us-east-1'
      const expectedLatestVersion = 41
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })

    test('returns 0 when no layer can be found', async () => {
      ;(Lambda as any).mockImplementation(() => makeMockLambda({}, {}))
      const runtime: Runtime = 'python3.7'
      const region = 'us-east-1'
      const expectedLatestVersion = 0
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })
  })

  describe('isMissingAWSCredentials', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })
    test('returns true when any AWS credential is missing', () => {
      process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = 'SOME-AWS-SECRET-ACCESS-KEY'
      expect(isMissingAWSCredentials()).toBe(true)

      // Reset env
      process.env = {}

      process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = 'SOME-AWS-ACCESS-KEY-ID'
      expect(isMissingAWSCredentials()).toBe(true)
    })

    test('returns false when AWS credentials are set', () => {
      process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = 'SOME-AWS-ACCESS-KEY-ID'
      process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = 'SOME-AWS-SECRET-ACCESS-KEY'
      expect(isMissingAWSCredentials()).toBe(false)
    })
  })

  describe('isMissingDatadogEnvVars', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })
    test('returns true when any Datadog Env Var is missing', () => {
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      expect(isMissingDatadogEnvVars()).toBe(true)

      // Reset env
      process.env = {}
      process.env[CI_API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
      expect(isMissingDatadogEnvVars()).toBe(true)

      process.env = {}
      process.env[CI_KMS_API_KEY_ENV_VAR] = 'SOME-AWS-KMS-API-KEY-CONTAINING-DATADOG-API-KEY'
      expect(isMissingDatadogEnvVars()).toBe(true)

      process.env = {}
      process.env[CI_API_KEY_SECRET_ARN_ENV_VAR] = 'SOME-AWS-SECRET-ARN-CONTAINING-DATADOG-API-KEY'
      expect(isMissingDatadogEnvVars()).toBe(true)
    })

    test('returns false when Datadog Env Vars are set with DATADOG_API_KEY', () => {
      process.env[CI_API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      expect(isMissingDatadogEnvVars()).toBe(false)
    })

    test('returns false when Datadog Env Vars are set with DATADOG_KMS_API_KEY', () => {
      process.env[CI_KMS_API_KEY_ENV_VAR] = 'SOME-AWS-KMS-API-KEY-CONTAINING-DATADOG-API-KEY'
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      expect(isMissingDatadogEnvVars()).toBe(false)
    })

    test('returns false when Datadog Env Vars are set with DATADOG_API_KEY_SECRET_ARN', () => {
      process.env[CI_API_KEY_SECRET_ARN_ENV_VAR] = 'SOME-AWS-SECRET-ARN-CONTAINING-DATADOG-API-KEY'
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      expect(isMissingDatadogEnvVars()).toBe(false)
    })
  })

  describe('isMissingDatadogSiteEnvVar', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns true when Datadog Site Env Var is missing', () => {
      expect(isMissingDatadogSiteEnvVar()).toBe(true)
    })

    test('returns false when Datadog Site Env Var is set', () => {
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      expect(isMissingDatadogSiteEnvVar()).toBe(false)
    })

    test('returns true when Datadog Site Env Var is set and is not a valid Datadog site', () => {
      process.env[CI_SITE_ENV_VAR] = 'datacathq.com'
      expect(isMissingDatadogSiteEnvVar()).toBe(true)
    })
  })

  describe('isMissingAnyDatadogApiKeyEnvVar', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns true when no Datadog Api Key is set', () => {
      expect(isMissingAnyDatadogApiKeyEnvVar()).toBe(true)
    })

    test('returns false when DATADOG_API_KEY is set', () => {
      process.env[CI_API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
      expect(isMissingAnyDatadogApiKeyEnvVar()).toBe(false)
    })

    test('returns false when DATADOG_KMS_API_KEY is set', () => {
      process.env[CI_KMS_API_KEY_ENV_VAR] = 'SOME-AWS-KMS-API-KEY-CONTAINING-DATADOG-API-KEY'
      expect(isMissingAnyDatadogApiKeyEnvVar()).toBe(false)
    })

    test('returns false when DATADOG_API_KEY_SECRET_ARN is set', () => {
      process.env[CI_API_KEY_SECRET_ARN_ENV_VAR] = 'SOME-AWS-SECRET-ARN-CONTAINING-DATADOG-API-KEY'
      expect(isMissingAnyDatadogApiKeyEnvVar()).toBe(false)
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
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region, settings)
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
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
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
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
      expect(layerArn).toEqual(
        `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python39-ARM`
      )
    })
  })

  describe('getLayerNameWithVersion', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('returns the correct name and version given an extension layer arn', () => {
      const layerName = DD_LAMBDA_EXTENSION_LAYER_NAME
      const version = '16'
      const layerNameWithVersion = `${layerName}:${version}`
      const layerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:${layerNameWithVersion}`
      expect(getLayerNameWithVersion(layerArn)).toBe(layerNameWithVersion)
    })

    test('returns the correct name and version given a library layer arn', () => {
      const layerName = 'Datadog-Python39'
      const version = '59'
      const layerNameWithVersion = `${layerName}:${version}`
      const layerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:${layerNameWithVersion}`
      expect(getLayerNameWithVersion(layerArn)).toBe(layerNameWithVersion)
    })

    test('returns undefined if arn is incomplete', () => {
      const layerArn = `arn:aws:lambda:sa-east-1:${mockAwsAccount}:layer:Datadog-Python39`
      expect(getLayerNameWithVersion(layerArn)).toBe(undefined)
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
  describe('Correctly handles multiple runtimes', () => {
    test('returns true if all runtimes are uniform', async () => {
      const configs: FunctionConfiguration[] = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func1',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func1',
            Handler: 'index.handler',
            Runtime: 'nodejs14.x',
          },
        },
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func2',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func2',
            Handler: 'index.handler',
            Runtime: 'nodejs12.x',
          },
        },
      ]
      expect(checkRuntimeTypesAreUniform(configs)).toBe(true)
    })

    test('returns false if runtimes are not uniform', async () => {
      const configs: FunctionConfiguration[] = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func1',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func1',
            Handler: 'index.handler',
            Runtime: 'nodejs14.x',
          },
        },
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func2',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func2',
            Handler: 'index.handler',
            Runtime: 'python3.9',
          },
        },
      ]
      expect(checkRuntimeTypesAreUniform(configs)).toBe(false)
    })
  })
})
