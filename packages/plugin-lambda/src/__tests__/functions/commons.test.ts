jest.mock('fs', () => ({
  ...jest.createMockFromModule<typeof fs>('fs'),
  promises: {
    readFile: jest.fn().mockResolvedValue(''),
  },
}))
jest.mock('@aws-sdk/credential-providers')
jest.mock('../../renderers/instrument-uninstrument-renderer')

import * as fs from 'fs'

import {CloudWatchLogsClient} from '@aws-sdk/client-cloudwatch-logs'
import {Architecture, LambdaClient, Runtime, UpdateFunctionConfigurationCommand} from '@aws-sdk/client-lambda'
import {fromNodeProviderChain} from '@aws-sdk/credential-providers'
import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {
  API_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  EXTRA_TAGS_REG_EXP,
  DD_TRACE_ENABLED_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {mockClient} from 'aws-sdk-client-mock'

import 'aws-sdk-client-mock-jest'

import {PluginCommand as InstrumentCommand} from '../../commands/instrument'
import {
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  DD_LAMBDA_EXTENSION_LAYER_NAME,
  DEFAULT_LAYER_AWS_ACCOUNT,
  EXTENSION_LAYER_KEY,
  GOVCLOUD_LAYER_AWS_ACCOUNT,
  LAMBDA_HANDLER_ENV_VAR,
  LayerKey,
  LAYER_LOOKUP,
  MERGE_XRAY_TRACES_ENV_VAR,
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
  handleLambdaFunctionUpdates,
  isMissingAnyDatadogApiKeyEnvVar,
  getAWSCredentials,
  isMissingDatadogEnvVars,
  sentenceMatchesRegEx,
  updateLambdaFunctionConfig,
  maskConfig,
} from '../../functions/commons'
import {FunctionConfiguration} from '../../interfaces'

import {
  MOCK_LAMBDA_CONFIG,
  mockAwsAccessKeyId,
  mockAwsAccount,
  mockAwsSecretAccessKey,
  mockLambdaClientCommands,
  mockLambdaLayers,
} from '../fixtures'

describe('commons', () => {
  const cloudWatchLogsClientMock = mockClient(CloudWatchLogsClient)
  const lambdaClientMock = mockClient(LambdaClient)

  beforeEach(() => {
    cloudWatchLogsClientMock.reset()
    lambdaClientMock.reset()
    mockLambdaClientCommands(lambdaClientMock)
  })
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
      const runtime = Runtime.python39
      const config = {
        Architectures: [Architecture.arm64],
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
    beforeEach(() => {
      lambdaClientMock.reset()
      mockLambdaClientCommands(lambdaClientMock)
    })

    test('finds latests version for Python39', async () => {
      const layer = `arn:aws:lambda:sa-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Python39`
      mockLambdaLayers(lambdaClientMock, {
        [`${layer}:1`]: {
          LayerName: layer,
          VersionNumber: 1,
        },
        [`${layer}:2`]: {
          LayerName: layer,
          VersionNumber: 2,
        },
        [`${layer}:10`]: {
          LayerName: layer,
          VersionNumber: 10,
        },
        [`${layer}:20`]: {
          LayerName: layer,
          VersionNumber: 20,
        },
        [`${layer}:30`]: {
          LayerName: layer,
          VersionNumber: 30,
        },
        [`${layer}:31`]: {
          LayerName: layer,
          VersionNumber: 31,
        },
        [`${layer}:32`]: {
          LayerName: layer,
          VersionNumber: 32,
        },
      })

      const runtime: Runtime = 'python3.9'
      const region = 'sa-east-1'
      const expectedLatestVersion = 32
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })

    test('finds latests version for Node20', async () => {
      const layer = `arn:aws:lambda:us-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Node20-x`
      mockLambdaLayers(lambdaClientMock, {
        [`${layer}:1`]: {
          LayerName: layer,
          VersionNumber: 1,
        },
        [`${layer}:2`]: {
          LayerName: layer,
          VersionNumber: 2,
        },
        [`${layer}:10`]: {
          LayerName: layer,
          VersionNumber: 10,
        },
        [`${layer}:20`]: {
          LayerName: layer,
          VersionNumber: 20,
        },
        [`${layer}:30`]: {
          LayerName: layer,
          VersionNumber: 30,
        },
        [`${layer}:40`]: {
          LayerName: layer,
          VersionNumber: 40,
        },
        [`${layer}:41`]: {
          LayerName: layer,
          VersionNumber: 41,
        },
      })
      const runtime: Runtime = 'nodejs20.x'
      const region = 'us-east-1'
      const expectedLatestVersion = 41
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })

    test('returns 0 when no layer can be found', async () => {
      const runtime: Runtime = 'python3.12'
      const region = 'us-east-1'
      const expectedLatestVersion = 0
      const latestVersionFound = await findLatestLayerVersion(runtime, region)
      expect(latestVersionFound).toBe(expectedLatestVersion)
    })
  })

  describe('getAWSCredentials', () => {
    const OLD_ENV = process.env

    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterEach(() => {
      process.env = OLD_ENV
    })

    // ignore reading `.aws/config` `.aws/credentials` files
    ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))

    test('returns credentials when `fromNodeProviderChain` returns a succesful promise', async () => {
      ;(fromNodeProviderChain as any).mockImplementation(
        () => () =>
          Promise.resolve({
            accessKeyId: mockAwsAccessKeyId,
            secretAccessKey: mockAwsSecretAccessKey,
          })
      )

      const credentials = await getAWSCredentials()
      expect(credentials).toStrictEqual({
        accessKeyId: mockAwsAccessKeyId,
        secretAccessKey: mockAwsSecretAccessKey,
      })
    })

    test('throws an error when `fromNodeProviderChain` fails when fetching credentials', async () => {
      ;(fromNodeProviderChain as any).mockImplementation(() => () => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await getAWSCredentials()
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }

      expect(error?.message).toBe("Couldn't fetch AWS credentials. Unexpected error")
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
      process.env[API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
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

    test('returns false when Datadog Env Vars are set with DD_API_KEY', () => {
      process.env[API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
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

    test('returns false when DD_API_KEY is set', () => {
      process.env[API_KEY_ENV_VAR] = 'SOME-DATADOG-API-KEY'
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
        lambdaFips: false,
      }
      const region = 'sa-east-1'
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as LayerKey, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Extension`)
    })

    test('gets sa-east-1 arm64 Lambda Extension layer ARN', async () => {
      const config = {
        Architectures: [Architecture.arm64],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
        lambdaFips: false,
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
        lambdaFips: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn({}, EXTENSION_LAYER_KEY as LayerKey, region, settings)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`)
    })

    test('gets us-gov-1 gov cloud arm64 Lambda Extension layer ARN', async () => {
      const config = {
        Architectures: [Architecture.arm64],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
        lambdaFips: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, EXTENSION_LAYER_KEY as LayerKey, region, settings)
      expect(layerArn).toEqual(
        `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension-ARM`
      )
    })

    test('gets sa-east-1 Node20 Lambda Library layer ARN', async () => {
      const runtime = Runtime.nodejs20x
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
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:Datadog-Node20-x`)
    })

    test('gets sa-east-1 Python39 arm64 Lambda Library layer ARN', async () => {
      const runtime = Runtime.python39
      const config = {
        Architectures: [Architecture.arm64],
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

    test('gets us-gov-1 Python312 gov cloud Lambda Library layer ARN', async () => {
      const runtime = Runtime.python312
      const config = {
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
        lambdaFips: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
      expect(layerArn).toEqual(`arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python312`)
    })

    test('gets us-gov-1 Python39 gov cloud arm64 Lambda Library layer ARN', async () => {
      const runtime = Runtime.python39
      const config = {
        Architectures: [Architecture.arm64],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
        lambdaFips: false,
      }
      const region = 'us-gov-1'
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
      expect(layerArn).toEqual(
        `arn:aws-us-gov:lambda:${region}:${GOVCLOUD_LAYER_AWS_ACCOUNT}:layer:Datadog-Python39-ARM`
      )
    })

    test('gets dotnet6 arm64 Lambda Library layer ARN', async () => {
      const runtime = Runtime.dotnet6
      const config = {
        Runtime: runtime,
        Architectures: [Architecture.arm64],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
        lambdaFips: false,
      }
      const region = 'us-east-1'
      const layerArn = getLayerArn(config, config.Runtime as LayerKey, region, settings)
      expect(layerArn).toEqual(`arn:aws:lambda:${region}:${mockAwsAccount}:layer:dd-trace-dotnet-ARM`)
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
      ['not@complying:regex-should-fail', false],
      ['1first-char-is-number:should-fail', false],
      ['_also-not-complying:should-fail', false],
      ['complying_tag:accepted/with/slashes.and.dots,but-empty-tag', false],
      ['also_complying:success,1but_is_illegal:should-fail', false],
      ['this:complies,also_this_one:yes,numb3r_in_name:should-succeed,dots:al.lo.wed', true],
      ['complying_ip_address_4:192.342.3134.231', true],
      ['complying:alone', true],
      ['one_divided_by_two:1/2,one_divided_by_four:0.25,three_minus_one_half:3-1/2', true],
      ['this_is_a_valid_t4g:yes/it.is-42', true],
      // multiple colons, periods in tag, slashes in tag
      ['env-staging:east:staging,version.minor:1,version.major:3.4/v3,category/service:not/defined', true],
      ['email:user@email.com,numb3r:t', true],
    ]

    test.each(tags)('check if the tags match the expected result from the regex', (tag, expectedResult) => {
      const result = !!sentenceMatchesRegEx(tag, EXTRA_TAGS_REG_EXP)
      expect(result).toEqual(expectedResult)
    })
  })

  describe('updateLambdaFunctionConfig', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      cloudWatchLogsClientMock.reset()
      lambdaClientMock.reset()
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('updates every lambda', async () => {
      const configs = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: 'index.handler',
            Runtime: Runtime.nodejs20x,
          },
          lambdaLibraryLayerArn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x',
          updateFunctionConfigurationCommandInput: {
            Environment: {
              Variables: {
                [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                [DD_TRACE_ENABLED_ENV_VAR]: 'false',
              },
            },
            FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
            Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22'],
          },
        },
      ]

      await Promise.all(
        configs.map(async (config) =>
          updateLambdaFunctionConfig(lambdaClientMock as any, cloudWatchLogsClientMock as any, config)
        )
      )
      expect(lambdaClientMock).toHaveReceivedCommandWith(UpdateFunctionConfigurationCommand, {
        Environment: {
          Variables: {
            [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
            [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
            [DD_TRACE_ENABLED_ENV_VAR]: 'false',
          },
        },
        FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
        Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:22'],
      })
    })
  })

  describe('handleLambdaFunctionUpdates', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      cloudWatchLogsClientMock.reset()
      lambdaClientMock.reset()
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    const stdout = {write: (_: any) => jest.fn()}
    const getConfigs = (lambdaClient: any) => [
      {
        lambdaClient,
        cloudWatchLogsClientMock,
        configs: [
          {
            functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
            lambdaConfig: {
              FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
            },
            lambdaLibraryLayerArn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x',
            updateFunctionConfigurationCommandInput: {
              Environment: {
                Variables: {
                  [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [DD_TRACE_ENABLED_ENV_VAR]: 'false',
                },
              },
              FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
              Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
              Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:XX'],
            },
          },
        ],
        region: 'us-east-1',
      },
      {
        lambdaClient,
        cloudWatchLogsClientMock,
        configs: [
          {
            functionARN: 'arn:aws:lambda:us-east-2:000000000000:function:autoinstrument',
            lambdaConfig: {
              FunctionArn: 'arn:aws:lambda:us-east-2:000000000000:function:autoinstrument',
              Handler: 'index.handler',
              Runtime: 'nodejs20.x',
            },
            lambdaLibraryLayerArn: 'arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x',
            updateFunctionConfigurationCommandInput: {
              Environment: {
                Variables: {
                  [LAMBDA_HANDLER_ENV_VAR]: 'index.handler',
                  [MERGE_XRAY_TRACES_ENV_VAR]: 'false',
                  [DD_TRACE_ENABLED_ENV_VAR]: 'false',
                },
              },
              FunctionName: 'arn:aws:lambda:us-east-2:000000000000:function:autoinstrument',
              Handler: '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
              Layers: ['arn:aws:lambda:us-east-1:464622532012:layer:Datadog-Node20-x:XX'],
            },
          },
        ],
        region: 'us-east-2',
      },
    ]

    test('throws an error when all functions from every region fail to update', async () => {
      lambdaClientMock.on(UpdateFunctionConfigurationCommand).rejects()

      const configs = getConfigs(lambdaClientMock)

      await expect(handleLambdaFunctionUpdates(configs as any, stdout as any)).rejects.toThrow()
    })

    test('to not throw an error when at least one function is updated', async () => {
      lambdaClientMock
        .on(UpdateFunctionConfigurationCommand, {
          FunctionName: 'arn:aws:lambda:us-east-1:000000000000:function:autoinstrument',
        })
        .rejects()

      const configs = getConfigs(lambdaClientMock)

      // when sucessful, the function doesnt do anything
      const result = await handleLambdaFunctionUpdates(configs as any, stdout as any)

      expect(result).toBe(undefined)
    })
  })

  describe('handles multiple runtimes', () => {
    test('returns true if all runtimes are uniform', async () => {
      const configs: FunctionConfiguration[] = [
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func3',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func3',
            Handler: 'index.handler',
            Runtime: 'nodejs16.x',
          },
        },
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func4',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func4',
            Handler: 'index.handler',
            Runtime: 'nodejs18.x',
          },
        },
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func5',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func5',
            Handler: 'index.handler',
            Runtime: 'nodejs20.x',
          },
        },
        {
          functionARN: 'arn:aws:lambda:us-east-1:000000000000:function:func6',
          lambdaConfig: {
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:func6',
            Handler: 'index.handler',
            Runtime: 'nodejs24.x',
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
            Runtime: 'nodejs20.x',
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

  describe('maskConfig', () => {
    it('should mask a Lambda config correctly', () => {
      const maskedConfig = maskConfig(MOCK_LAMBDA_CONFIG)
      expect(maskedConfig).toMatchSnapshot()
    })

    it('should not modify config if env vars are missing', () => {
      const lambdaConfigCopy = JSON.parse(JSON.stringify(MOCK_LAMBDA_CONFIG))
      delete lambdaConfigCopy.Environment.Variables
      const maskedConfig = maskConfig(lambdaConfigCopy)
      expect(maskedConfig).toMatchSnapshot()
    })
  })
})
