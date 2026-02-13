import {CommandContext} from '@datadog/datadog-ci-base'
import {
  createCommand,
  createMockContext,
  getEnvVarPlaceholders,
} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import * as APIKeyHelpers from '@datadog/datadog-ci-base/helpers/apikey'
import {MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'
import chalk from 'chalk'
import {Cli} from 'clipanion'

import {RNSourcemap} from '../interfaces'
import {ReactNativeUploadCommand} from '../upload'

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const command = new ReactNativeUploadCommand()

      expect(command['getRequestBuilder'].bind(command)).toThrow(
        `Missing ${chalk.bold('DATADOG_API_KEY')} or ${chalk.bold('DD_API_KEY')} in your environment.`
      )
    })
  })

  describe('extractAndAddDebugIdToPayload', () => {
    test('debug ID is extracted from sourcemaps and added to multipart payload', async () => {
      // GIVEN
      const sourcemap = new RNSourcemap(
        'bundle.min.js',
        'src/commands/react-native/__tests__/fixtures/sourcemap-with-debug-id/bundle.min.js.map'
      )

      // WHEN
      const payload = sourcemap.asMultipartPayload(
        'cli-version',
        'service',
        'version',
        'projectPath',
        'android',
        'build',
        createMockContext() as CommandContext
      )

      // THEN
      const event = payload.content.get('event') as MultipartStringValue
      const eventValue = JSON.parse(event['value']) as {debug_id: string}
      expect(eventValue['debug_id']).toBe('a422b269-0dba-4341-93c2-73e1bcf71fbb')
    })
  })

  describe('addRepositoryDataToPayloads', () => {
    test('repository url and commit still defined without payload', async () => {
      const write = jest.fn()
      const command = createCommand(ReactNativeUploadCommand, {stdout: {write}})

      const sourcemaps = new Array<RNSourcemap>(
        new RNSourcemap(
          'empty.min.js',
          'src/commands/react-native/__tests__/fixtures/sourcemap-with-no-files/empty.min.js.map'
        )
      )
      // The command will fetch git metadatas for the current datadog-ci repository.
      // The `empty.min.js.map` contains no files, therefore no file payload should be set.
      await command['addRepositoryDataToPayloads'](sourcemaps)
      expect(sourcemaps[0].gitData).toBeDefined()
      expect(sourcemaps[0].gitData!.gitRepositoryURL).toBeDefined()
      expect(sourcemaps[0].gitData!.gitCommitSha).toHaveLength(40)
      expect(sourcemaps[0].gitData!.gitRepositoryPayload).toBeUndefined()
    })

    test('should include payload', async () => {
      const write = jest.fn()
      const command = createCommand(ReactNativeUploadCommand, {stdout: {write}})

      const sourcemaps = new Array<RNSourcemap>(
        new RNSourcemap('main.jsbundle', 'src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map')
      )
      // The command will fetch git metadatas for the current datadog-ci repository.
      // The `main.jsbundle.map` contains the "git.test.ts" filename which matches a tracked filename,
      // therefore a file payload should be set.
      // Removing the "git.test.ts" file will break this test.
      await command['addRepositoryDataToPayloads'](sourcemaps)
      expect(sourcemaps[0].gitData).toBeDefined()
      expect(sourcemaps[0].gitData!.gitRepositoryURL).toBeDefined()
      expect(sourcemaps[0].gitData!.gitCommitSha).toHaveLength(40)
      expect(sourcemaps[0].gitData!.gitRepositoryPayload).toBeDefined()
    })
  })
})

describe('execute', () => {
  const runCLI = async (
    bundle: string,
    options?: {configPath?: string; uploadBundle?: boolean; env?: Record<string, string>}
  ) => {
    const cli = new Cli()
    cli.register(ReactNativeUploadCommand)

    const context = createMockContext()
    const command = [
      'react-native',
      'upload',
      '--release-version',
      '1.23.4',
      '--build-version',
      '1023040',
      '--service',
      'com.company.app',
      '--sourcemap',
      `${bundle}.map`,
      '--platform',
      'android',
      '--dry-run',
    ]
    if (options?.configPath) {
      command.push('--config', options.configPath)
      process.env = {}
    } else {
      process.env = getEnvVarPlaceholders()
    }
    if (options?.uploadBundle !== false) {
      command.push('--bundle', bundle)
    }
    if (options?.env) {
      process.env = {
        ...process.env,
        ...options.env,
      }
    }
    const code = await cli.run(command, context)

    return {context, code}
  }

  test('relative path', async () => {
    const {context, code} = await runCLI('./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle')
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: 'main.jsbundle',
      concurrency: 20,
      bundleName: 'main.jsbundle',
      platform: 'android',
      projectPath: '',
      service: 'com.company.app',
      sourcemapPath: './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map',
      sourcemapsPaths: ['./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map'],
      version: '1.23.4',
    })
  })

  test('absolute path', async () => {
    const {context, code} = await runCLI(
      process.cwd() + '/src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle'
    )
    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: `main.jsbundle`,
      concurrency: 20,
      bundleName: 'main.jsbundle',
      platform: 'android',
      projectPath: '',
      service: 'com.company.app',
      sourcemapPath: `${process.cwd()}/src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map`,
      sourcemapsPaths: [`${process.cwd()}/src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map`],
      version: '1.23.4',
    })
  })

  test('reads config from JSON file', async () => {
    const apiKeyValidatorSpy = jest.spyOn(APIKeyHelpers, 'newApiKeyValidator')
    const {context, code} = await runCLI('./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle', {
      configPath: './src/commands/react-native/__tests__/fixtures/config/config-with-api-key.json',
    })

    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: 'main.jsbundle',
      concurrency: 20,
      bundleName: 'main.jsbundle',
      platform: 'android',
      projectPath: '',
      service: 'com.company.app',
      sourcemapPath: './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map',
      sourcemapsPaths: ['./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map'],
      version: '1.23.4',
    })
    expect(apiKeyValidatorSpy).toHaveBeenCalledWith({
      apiKey: '12345678900987654321aabbccddeeff',
      datadogSite: expect.anything(),
      metricsLogger: expect.anything(),
    })
  })

  test('uses API Key from env over config from JSON file', async () => {
    const apiKeyValidatorSpy = jest.spyOn(APIKeyHelpers, 'newApiKeyValidator')

    const {context, code} = await runCLI('./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle', {
      configPath: './src/commands/react-native/__tests__/fixtures/config/config-with-api-key.json',
      env: {
        DATADOG_API_KEY: 'env_API_key',
      },
    })

    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    expect(apiKeyValidatorSpy).toHaveBeenCalledWith({
      apiKey: 'env_API_key',
      datadogSite: expect.anything(),
      metricsLogger: expect.anything(),
    })
    expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
    expect(output).toContain('The environment API key ending in _key will be used.')
  })

  test('prints warning when no bundle file is specified', async () => {
    const {context, code} = await runCLI('./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle', {
      configPath: './src/commands/react-native/__tests__/fixtures/config/config-with-api-key.json',
      uploadBundle: false,
    })

    const output = context.stdout.toString().split('\n')
    expect(code).toBe(0)
    expect(output[2]).toContain(
      '⚠️ --bundle option was not provided. A default bundle name will be used. Please update @datadog/mobile-react-native or pass a --bundle option.'
    )
  })
})

interface ExpectedOutput {
  build: string
  bundlePath: string
  concurrency: number
  bundleName: string
  platform: string
  projectPath: string
  service: string
  sourcemapPath: string
  sourcemapsPaths: string[]
  version: string
}

const checkConsoleOutput = (output: string[], expected: ExpectedOutput) => {
  expect(output[0]).toContain('DRY-RUN MODE ENABLED. WILL NOT UPLOAD SOURCEMAPS')
  expect(output[1]).toContain('Starting upload.')
  expect(output[2]).toContain(
    `Upload of ${expected.sourcemapPath} for bundle ${expected.bundlePath} on platform ${expected.platform} with project path ${expected.projectPath}`
  )
  expect(output[3]).toContain(`version: ${expected.version} build: ${expected.build} service: ${expected.service}`)
  expect(output[4]).toContain(
    `Please ensure you use the same values during SDK initialization to guarantee the success of the unminify process.`
  )
  expect(output[5]).toContain(
    `After upload is successful sourcemap files will be processed and ready to use within the next 5 minutes.`
  )

  const uploadedFileLines = output.slice(6, -4).filter((line) => !line.includes('Extracted Debug ID from sourcemap'))
  expect(uploadedFileLines.length).toEqual(expected.sourcemapsPaths.length) // Safety check
  uploadedFileLines.forEach((_, index) => {
    expect(uploadedFileLines[index]).toContain(
      `[DRYRUN] Uploading sourcemap ${expected.sourcemapsPaths} for JS file ${expected.bundleName}`
    )
  })
  if (uploadedFileLines.length > 1) {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemaps with success`)
  } else {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemap with success`)
  }
}
