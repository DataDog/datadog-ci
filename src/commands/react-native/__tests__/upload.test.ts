import os from 'os'

import chalk from 'chalk'
import {Cli} from 'clipanion/lib/advanced'

import * as APIKeyHelpers from '../../../helpers/apikey'

import {RNSourcemap} from '../interfaces'
import {UploadCommand} from '../upload'

describe('upload', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const command = new UploadCommand()

      expect(command['getRequestBuilder'].bind(command)).toThrow(
        `Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`
      )
    })
  })

  describe('addRepositoryDataToPayloads', () => {
    test('repository url and commit still defined without payload', async () => {
      const command = new UploadCommand()
      const write = jest.fn()
      command.context = {stdout: {write}} as any
      const sourcemaps = new Array<RNSourcemap>(
        new RNSourcemap('src/commands/react-native/__tests__/fixtures/sourcemap-with-no-files/empty.min.js.map')
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
      const command = new UploadCommand()
      const write = jest.fn()
      command.context = {stdout: {write}} as any
      const sourcemaps = new Array<RNSourcemap>(
        new RNSourcemap('src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map')
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
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DATADOG_API_KEY: 'PLACEHOLDER'}
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
    if (options?.uploadBundle) {
      command.push('--bundle', bundle)
    }
    if (options?.configPath) {
      command.push('--config', options.configPath)
      delete process.env.DATADOG_API_KEY
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
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle',
      concurrency: 20,
      jsFilesURLs: ['./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle'],
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
    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: `${process.cwd()}/src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle`,
      concurrency: 20,
      jsFilesURLs: [`${process.cwd()}/src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle`],
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

    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    checkConsoleOutput(output, {
      build: '1023040',
      bundlePath: './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle',
      concurrency: 20,
      jsFilesURLs: ['./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle'],
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

    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    expect(apiKeyValidatorSpy).toHaveBeenCalledWith({
      apiKey: 'env_API_key',
      datadogSite: expect.anything(),
      metricsLogger: expect.anything(),
    })
    expect(output).toContain('API keys were specified both in a configuration file and in the environment.')
    expect(output).toContain('The environment API key ending in _key will be used.')
  })

  test('prints warning when bundle file is specified', async () => {
    const {context, code} = await runCLI('./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle', {
      configPath: './src/commands/react-native/__tests__/fixtures/config/config-with-api-key.json',
      uploadBundle: true,
    })

    const output = context.stdout.toString().split(os.EOL)
    expect(code).toBe(0)
    expect(output[1]).toContain(
      "--bundle option has been deprecated. The js bundle won't be sent. This will not affect the error tracking of your app."
    )
  })
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(UploadCommand)

  return cli
}

const createMockContext = () => {
  let data = ''

  return {
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

interface ExpectedOutput {
  build: string
  bundlePath?: string
  concurrency: number
  jsFilesURLs?: string[]
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
    `Upload of ${expected.sourcemapPath} on platform ${expected.platform} with project path ${expected.projectPath}`
  )
  expect(output[3]).toContain(`version: ${expected.version} build: ${expected.build} service: ${expected.service}`)
  const uploadedFileLines = output.slice(4, -4)
  expect(uploadedFileLines.length).toEqual(expected.sourcemapsPaths.length) // Safety check
  expect(uploadedFileLines.length).toEqual(expected.jsFilesURLs?.length || 1) // Safety check
  uploadedFileLines.forEach((_, index) => {
    expect(uploadedFileLines[index]).toContain(`[DRYRUN] Uploading sourcemap ${expected.sourcemapsPaths}`)
  })
  if (uploadedFileLines.length > 1) {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemaps with success`)
  } else {
    expect(output.slice(-2, -1)[0]).toContain(`[DRYRUN] Handled ${uploadedFileLines.length} sourcemap with success`)
  }
}
