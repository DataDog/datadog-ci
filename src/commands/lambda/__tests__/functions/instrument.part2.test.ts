jest.mock('../../loggroup')

import {Architecture, LambdaClient, Runtime} from '@aws-sdk/client-lambda'
import {mockClient} from 'aws-sdk-client-mock'

import {API_KEY_ENV_VAR, CI_API_KEY_ENV_VAR} from '../../../../constants'
import {MOCK_DATADOG_API_KEY} from '../../../../helpers/__tests__/testing-tools'

import {CI_API_KEY_SECRET_ARN_ENV_VAR, CI_KMS_API_KEY_ENV_VAR, DEFAULT_LAYER_AWS_ACCOUNT} from '../../constants'
import {calculateUpdateRequest} from '../../functions/instrument'
import {InstrumentationSettings} from '../../interfaces'

import {mockAwsAccount, mockLambdaClientCommands, mockLambdaLayers} from '../fixtures'

describe('instrument', () => {
  describe('calculateUpdateRequest', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })

    test('calculates an update request with just lambda library layers', async () => {
      const runtime = Runtime.nodejs20x
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
        llmobsMlApp: 'my-ml-app',
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_LLMOBS_AGENTLESS_ENABLED": "false",
              "DD_LLMOBS_ENABLED": "true",
              "DD_LLMOBS_ML_APP": "my-ml-app",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node20-x:5",
          ],
        }
      `)
    })

    test.each([
      [Runtime.python39, 'Datadog-Python39'],
      [Runtime.python310, 'Datadog-Python310'],
      [Runtime.python311, 'Datadog-Python311'],
      [Runtime.python312, 'Datadog-Python312'],
      [Runtime.python313, 'Datadog-Python313'],
    ])('calculates an update request for %s', async (runtime: Runtime, layer: string) => {
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 71,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:${layer}:71",
          ],
        }
      `)
    })

    test.each([
      [Runtime.python39, 'Datadog-Python39-ARM'],
      [Runtime.python310, 'Datadog-Python310-ARM'],
      [Runtime.python311, 'Datadog-Python311-ARM'],
      [Runtime.python312, 'Datadog-Python312-ARM'],
      [Runtime.python313, 'Datadog-Python313-ARM'],
    ])(
      'calculates an update request with just lambda library layers in arm architecture',
      async (runtime: Runtime, layer: string) => {
        const config = {
          Architectures: [Architecture.arm64],
          FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Handler: 'handler.hello',
          Layers: [],
          Runtime: runtime,
        }
        const settings = {
          flushMetricsToLogs: false,
          layerAWSAccount: mockAwsAccount,
          layerVersion: 11,
          mergeXrayTraces: false,
          tracingEnabled: false,
        }
        const region = 'sa-east-1'

        const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
        expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "handler.hello",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:${layer}:11",
          ],
        }
      `)
      }
    )

    test('calculates an update request with a lambda library, extension, and DATADOG_API_KEY', async () => {
      process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
      const runtime = Runtime.nodejs20x
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_API_KEY": "02aeb762fff59ac0d5ad1536cd9633bd",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node20-x:5",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DD_API_KEY', async () => {
      process.env[API_KEY_ENV_VAR] = 'SOME-DD-API-KEY'
      const runtime = Runtime.nodejs20x
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_API_KEY": "SOME-DD-API-KEY",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "/opt/nodejs/node_modules/datadog-lambda-js/handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Node20-x:5",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DATADOG_API_KEY_SECRET_ARN', async () => {
      process.env[CI_API_KEY_SECRET_ARN_ENV_VAR] = 'some-secret:arn:from:aws'
      const runtime = Runtime.python39
      const config = {
        FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        extensionVersion: 11,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 49,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_API_KEY_SECRET_ARN": "some-secret:arn:from:aws",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:11",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Python39:49",
          ],
        }
      `)
    })

    test('calculates an update request with a lambda library, extension, and DATADOG_KMS_API_KEY', async () => {
      process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
      const runtime = Runtime.python39
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_KMS_API_KEY": "5678",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
          "Handler": "datadog_lambda.handler.handler",
          "Layers": [
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Extension:6",
            "arn:aws:lambda:sa-east-1:123456789012:layer:Datadog-Python39:5",
          ],
        }
      `)
    })

    test('prioritizes the KMS API KEY when all of them are exported', async () => {
      process.env = {
        [CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY,
        [CI_API_KEY_SECRET_ARN_ENV_VAR]: '5678',
        [CI_KMS_API_KEY_ENV_VAR]: 'should-be-selected',
      }

      const config = {
        FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const runtime = 'python3.9'
      const region = 'sa-east-1'
      const updateRequest = await calculateUpdateRequest(config, {} as any, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_KMS_API_KEY": "should-be-selected",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_SITE": "datadoghq.com",
            },
          },
          "FunctionName": "arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world",
        }
      `)
    })

    test("doesn't set DD_FLUSH_TO_LOGS when extension is being used", async () => {
      process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY

      const config = {
        FunctionArn: 'arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const runtime = 'python3.9'
      const region = 'sa-east-1'
      const settings: InstrumentationSettings = {
        extensionVersion: 13,
        flushMetricsToLogs: true,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_API_KEY": "02aeb762fff59ac0d5ad1536cd9633bd",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:sa-east-1:123456789012:function:lambda-hello-world",
          "Layers": [
            "arn:aws:lambda:sa-east-1:464622532012:layer:Datadog-Extension:13",
          ],
        }
      `)
    })

    test('by default calculates an update request with DATADOG_SITE being set to datadoghq.com', async () => {
      const runtime = Runtime.python39
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.com",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
        }
      `)
    })

    test('calculates an update request with DATADOG_SITE being set to datadoghq.eu', async () => {
      process.env.DATADOG_SITE = 'datadoghq.eu'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'sa-east-1'
      const runtime = 'python3.9'

      const updateRequest = await calculateUpdateRequest(config, settings, region, runtime)
      expect(updateRequest).toMatchInlineSnapshot(`
        {
          "Environment": {
            "Variables": {
              "DD_FLUSH_TO_LOG": "false",
              "DD_LAMBDA_HANDLER": "index.handler",
              "DD_MERGE_XRAY_TRACES": "false",
              "DD_SITE": "datadoghq.eu",
              "DD_TRACE_ENABLED": "false",
            },
          },
          "FunctionName": "arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world",
        }
      `)
    })

    test('throws an error when an invalid DATADOG_SITE url is given', async () => {
      process.env.DATADOG_SITE = 'datacathq.eu'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        flushMetricsToLogs: false,
        interactive: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-east-1'
      const runtime = 'python3.9'
      let error
      try {
        await calculateUpdateRequest(config, settings, region, runtime)
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe(
        'Warning: Invalid site URL. Must be either datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com,  ap1.datadoghq.com, ap2.datadoghq.com, or ddog-gov.com.'
      )
    })

    test('throws an error when neither DATADOG_API_KEY nor DATADOG_KMS_API_KEY are given through the environment while using extensionVersion', async () => {
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
      }
      const settings = {
        extensionVersion: 6,
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 5,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const region = 'us-east-1'
      const runtime = 'python3.9'
      let error
      try {
        await calculateUpdateRequest(config, settings, region, runtime)
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe(
        "When 'extensionLayer' is set, DATADOG_API_KEY, DATADOG_KMS_API_KEY, or DATADOG_API_KEY_SECRET_ARN must also be set"
      )
    })

    test('throws error when trying to add `DD_API_KEY_SECRET_ARN` while using sync metrics in a node runtime', async () => {
      process.env[CI_API_KEY_SECRET_ARN_ENV_VAR] = 'some-secret:arn:from:aws'
      const runtime = Runtime.nodejs20x
      const region = 'us-east-1'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: runtime,
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 13,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      let error
      try {
        await calculateUpdateRequest(config, settings, region, runtime)
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe(
        '`apiKeySecretArn` is not supported for Node runtimes when using Synchronous Metrics. Use either `apiKey` or `apiKmsKey`.'
      )
    })

    describe('test universal instrumentation workflow for Java and .Net', () => {
      const region = 'us-east-1'
      const config = {
        FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
        Handler: 'index.handler',
        Layers: [],
        Runtime: 'runtime',
      }
      const settings = {
        flushMetricsToLogs: false,
        layerAWSAccount: mockAwsAccount,
        layerVersion: 13,
        mergeXrayTraces: false,
        tracingEnabled: false,
      }
      const dotnetRuntime = Runtime.dotnet6
      const javaRuntime = Runtime.java11

      describe(`test for runtime ${dotnetRuntime}`, () => {
        const dotNetConfig = {...config, Runtime: dotnetRuntime}
        const dotNetConfigOnArm86 = {...config, Runtime: dotnetRuntime, Architectures: [Architecture.arm64]}

        test('should throw error when the extension version and trace version are not compatible', async () => {
          process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
          const badSettings = {...settings, extensionVersion: 24, layerVersion: 3}
          let error
          try {
            await calculateUpdateRequest(dotNetConfig, badSettings, region, dotnetRuntime)
          } catch (e) {
            if (e instanceof Error) {
              error = e
            }
          }
          expect(error?.message).toBe(
            `For the ${dotnetRuntime} runtime, the dd-trace version 3 is not compatible with the dd-extension version 24`
          )
        })

        test('should throw error if it is running on arm64 with an old dd-extension version', async () => {
          process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
          const curSettings = {...settings, extensionVersion: 23}
          let error
          try {
            await calculateUpdateRequest(dotNetConfigOnArm86, curSettings, region, dotnetRuntime)
          } catch (e) {
            if (e instanceof Error) {
              error = e
            }
          }
          expect(error?.message).toBe(
            'Instrumenting arm64 architecture is not supported for the given dd-extension version. Please choose the latest dd-extension version or use x86_64 architecture.'
          )
        })

        const baseVariables = {
          DD_KMS_API_KEY: '5678',
          DD_MERGE_XRAY_TRACES: 'false',
          DD_SITE: 'datadoghq.com',
          DD_TRACE_ENABLED: 'false',
        }
        const compatibleTracerAndExtension = {
          Environment: {
            Variables: {...baseVariables, AWS_LAMBDA_EXEC_WRAPPER: '/opt/datadog_wrapper'},
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: [
            'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:25',
            'arn:aws:lambda:us-east-1:123456789012:layer:dd-trace-dotnet:4',
          ],
        }
        const oldExtensionVersion = {
          Environment: {
            Variables: {
              ...baseVariables,
              CORECLR_ENABLE_PROFILING: '1',
              CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
              CORECLR_PROFILER_PATH: '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so',
              DD_DOTNET_TRACER_HOME: '/opt/datadog',
            },
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: [
            'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:23',
            'arn:aws:lambda:us-east-1:123456789012:layer:dd-trace-dotnet:2',
          ],
        }
        const traceUndefined = {
          Environment: {
            Variables: {
              ...baseVariables,
              CORECLR_ENABLE_PROFILING: '1',
              CORECLR_PROFILER: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
              CORECLR_PROFILER_PATH: '/opt/datadog/Datadog.Trace.ClrProfiler.Native.so',
              DD_DOTNET_TRACER_HOME: '/opt/datadog',
            },
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: ['arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:15'],
        }

        test.each`
          extensionVersion | traceVersion | outputResult
          ${25}            | ${4}         | ${compatibleTracerAndExtension}
          ${23}            | ${2}         | ${oldExtensionVersion}
          ${15}            | ${undefined} | ${traceUndefined}
        `(
          'should the output match the expected if extensionVersion=$extensionVersion and traceVersion=$traceVersion',
          async ({extensionVersion, traceVersion, outputResult}) => {
            const curSettings = {...settings, extensionVersion, layerVersion: traceVersion}
            process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
            const updateRequest = await calculateUpdateRequest(dotNetConfig, curSettings, region, dotnetRuntime)
            expect(updateRequest).toEqual(outputResult)
          }
        )
      })

      describe(`test for runtime ${javaRuntime}`, () => {
        const javaConfig = {...config, Runtime: javaRuntime}

        test('should throw error when the extension version and trace version are not compatible', async () => {
          process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
          const badSettings = {...settings, extensionVersion: 24, layerVersion: 4}
          let error
          try {
            await calculateUpdateRequest(javaConfig, badSettings, region, javaRuntime)
          } catch (e) {
            if (e instanceof Error) {
              error = e
            }
          }
          expect(error?.message).toBe(
            `For the ${javaRuntime} runtime, the dd-trace version 4 is not compatible with the dd-extension version 24`
          )
        })

        const baseVariables = {
          DD_KMS_API_KEY: '5678',
          DD_MERGE_XRAY_TRACES: 'false',
          DD_SITE: 'datadoghq.com',
          DD_TRACE_ENABLED: 'false',
        }
        const compatibleTracerAndExtension = {
          Environment: {
            Variables: {...baseVariables, AWS_LAMBDA_EXEC_WRAPPER: '/opt/datadog_wrapper'},
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: [
            'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:25',
            'arn:aws:lambda:us-east-1:123456789012:layer:dd-trace-java:5',
          ],
        }
        const oldExtensionVersion = {
          Environment: {
            Variables: {
              ...baseVariables,
            },
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: [
            'arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:23',
            'arn:aws:lambda:us-east-1:123456789012:layer:dd-trace-java:2',
          ],
        }
        const traceUndefined = {
          Environment: {
            Variables: {
              ...baseVariables,
            },
          },
          FunctionName: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
          Layers: ['arn:aws:lambda:us-east-1:123456789012:layer:Datadog-Extension:15'],
        }

        test.each`
          extensionVersion | traceVersion | outputResult
          ${25}            | ${5}         | ${compatibleTracerAndExtension}
          ${23}            | ${2}         | ${oldExtensionVersion}
          ${15}            | ${undefined} | ${traceUndefined}
        `(
          'should the output match the expected if extensionVersion=$extensionVersion and traceVersion=$traceVersion',
          async ({extensionVersion, traceVersion, outputResult}) => {
            const curSettings = {...settings, extensionVersion, layerVersion: traceVersion}
            process.env[CI_KMS_API_KEY_ENV_VAR] = '5678'
            const updateRequest = await calculateUpdateRequest(javaConfig, curSettings, region, javaRuntime)
            expect(updateRequest).toEqual(outputResult)
          }
        )
      })
    })

    describe('sets handlers correctly', () => {
      const lambdaClientMock = mockClient(LambdaClient)

      describe('interactive mode', () => {
        const extensionLayer = `arn:aws:lambda:us-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:Datadog-Extension`

        beforeAll(() => {
          lambdaClientMock.reset()
          process.env = {}

          mockLambdaClientCommands(lambdaClientMock)
        })

        afterAll(() => {
          process.env = OLD_ENV
        })

        it.each([
          [
            'python',
            {
              runtime: Runtime.python311,
              layer: 'Datadog-Python311',
            },
            'datadog_lambda.handler.handler',
          ],
          [
            'node',
            {
              runtime: Runtime.nodejs16x,
              layer: 'Datadog-Node16-x',
            },
            '/opt/nodejs/node_modules/datadog-lambda-js/handler.handler',
          ],
        ])('%s', async (_, test, expected) => {
          process.env[CI_API_KEY_ENV_VAR] = MOCK_DATADOG_API_KEY
          const libraryLayer = `arn:aws:lambda:us-east-1:${DEFAULT_LAYER_AWS_ACCOUNT}:layer:${test.layer}`

          // Mock Layers for interactive mode.
          mockLambdaLayers(lambdaClientMock, {
            [`${libraryLayer}:1`]: {
              LayerName: `${libraryLayer}`,
              VersionNumber: 1,
            },
            [`${extensionLayer}:1`]: {
              LayerName: `${extensionLayer}`,
              VersionNumber: 1,
            },
          })

          const config = {
            FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:lambda-hello-world',
            Handler: 'index.handler',
            Layers: [],
            Runtime: test.runtime,
          }

          const settings = {
            flushMetricsToLogs: false,
            interactive: true, // Interactive mode
            mergeXrayTraces: false,
            tracingEnabled: false,
          }

          const updateRequest = await calculateUpdateRequest(config, settings, 'us-east-1', test.runtime as any)

          expect(updateRequest?.Handler).toBe(expected)
        })
      })
    })
  })
})
