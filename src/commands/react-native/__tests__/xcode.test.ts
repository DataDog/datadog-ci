import {Cli} from 'clipanion/lib/advanced'

import * as formatGitSourcemapsData from '../../../helpers/git/format-git-sourcemaps-data'

import * as utils from '../utils'
import {XCodeCommand} from '../xcode'

beforeEach(() => {
  delete process.env.CONFIGURATION
  delete process.env.CONFIGURATION_BUILD_DIR
  delete process.env.CURRENT_PROJECT_VERSION
  delete process.env.DATADOG_API_KEY
  delete process.env.EXTRA_PACKAGER_ARGS
  delete process.env.INFOPLIST_FILE
  delete process.env.MARKETING_VERSION
  delete process.env.PODS_PODFILE_DIR_PATH
  delete process.env.PRODUCT_BUNDLE_IDENTIFIER
  delete process.env.PROJECT_DIR
  delete process.env.SERVICE_NAME_IOS
  delete process.env.SOURCEMAP_FILE
  delete process.env.UNLOCALIZED_RESOURCES_FOLDER_PATH
  delete process.env.USE_HERMES
  delete process.env.SKIP_BUNDLING
  delete process.env.PLATFORM_NAME
  delete process.env.FORCE_BUNDLING
  reactNativeVersionSpy.mockClear()
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(XCodeCommand)

  return cli
}

const reactNativeVersionSpy = jest.spyOn(utils, 'getReactNativeVersion').mockReturnValue(undefined)

const createMockContext = () => {
  let data = ''
  let errorData = ''

  return {
    stderr: {
      toString: () => errorData,
      write: (input: string) => {
        errorData += input
      },
    },
    stdout: {
      toString: () => data,
      write: (input: string) => {
        data += input
      },
    },
  }
}

const basicEnvironment = {
  CONFIGURATION: 'Release',
  CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/basic-ios',
  CURRENT_PROJECT_VERSION: '000020',
  MARKETING_VERSION: '0.0.2',
  PRODUCT_BUNDLE_IDENTIFIER: 'com.myapp.test',
  SOURCEMAP_FILE: './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map',
  PLATFORM_NAME: 'iphoneos',
}

const runCLI = async (
  script?: string,
  options?: {
    composeSourcemapsPath?: string
    configPath?: string
    disableGit?: boolean
    force?: boolean
    infoPlistPath?: string
    repositoryURL?: string
    service?: string
  }
) => {
  const cli = makeCli()
  const context = createMockContext() as any
  process.env = {...process.env, DATADOG_API_KEY: 'PLACEHOLDER'}

  const command = ['react-native', 'xcode']
  if (script) {
    command.push(script)
  }
  command.push('--dry-run')
  if (options?.force) {
    command.push('--force')
  }
  if (options?.disableGit) {
    command.push('--disable-git')
  }
  if (options?.configPath) {
    command.push('--config', options.configPath)
  }
  if (options?.repositoryURL) {
    command.push('--repository-url', options.repositoryURL)
  }
  if (options?.infoPlistPath) {
    command.push('--info-plist-path', options.infoPlistPath)
  }
  if (options?.service) {
    command.push('--service')
    command.push(options.service)
  }
  if (options?.composeSourcemapsPath) {
    command.push('--compose-sourcemaps-path')
    command.push(options.composeSourcemapsPath)
  }
  const code = await cli.run(command, context)

  return {context, code}
}

describe('xcode', () => {
  describe('getBundleLocation', () => {
    test('should return the location from CONFIGURATION_BUILD_DIR', () => {
      process.env.CONFIGURATION_BUILD_DIR = './src/commands/react-native/__tests__/fixtures/basic-ios'
      const command = new XCodeCommand()
      expect(command['getBundleLocation']()).toBe(
        './src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle'
      )
    })

    test('should return null if no CONFIGURATION_BUILD_DIR is specified', () => {
      const command = new XCodeCommand()
      expect(command['getBundleLocation']()).toBeNull()
    })
  })

  describe('getSourcemapsLocation', () => {
    test('should return the location from SOURCEMAP_FILE', () => {
      process.env.SOURCEMAP_FILE = './main.jsbundle.map'
      const command = new XCodeCommand()
      expect(command['getSourcemapsLocation']()).toMatch('./main.jsbundle.map')
    })

    test('should return the location from EXTRA_PACKAGER_ARGS', () => {
      process.env.EXTRA_PACKAGER_ARGS = '--bundle-output ./main.jsbundle --sourcemap-output ./main.jsbundle.map'
      const command = new XCodeCommand()
      expect(command['getSourcemapsLocation']()).toBe('./main.jsbundle.map')
    })

    test('should return null if no location is in EXTRA_PACKAGER_ARGS and SOURCEMAP_FILE is undefined', () => {
      process.env.EXTRA_PACKAGER_ARGS = '--bundle-output ./main.jsbundle'
      const command = new XCodeCommand()
      expect(command['getSourcemapsLocation']()).toBeNull()
    })

    test('should return null if EXTRA_PACKAGER_ARGS and SOURCEMAP_FILE are undefined', () => {
      const command = new XCodeCommand()
      expect(command['getSourcemapsLocation']()).toBeNull()
    })
  })

  describe('execute', () => {
    test('should run the provided script and upload sourcemaps', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should run the provided script and upload sourcemaps when no path is provided', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        // This ensures we point to an existing file as the command is ran without any script path
        DATADOG_CI_REACT_NATIVE_PATH: './src/commands/react-native/__tests__/fixtures/react-native',
      }
      const {context, code} = await runCLI()
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should run the provided script, compose and upload sourcemaps when using hermes', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/compose-sourcemaps',
        UNLOCALIZED_RESOURCES_FOLDER_PATH: 'MyApp.app',
        USE_HERMES: 'true',
      }
      reactNativeVersionSpy.mockReturnValue('0.69.0')

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          composeSourcemapsPath:
            './src/commands/react-native/__tests__/fixtures/compose-sourcemaps/compose-sourcemaps.js',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Hermes detected, composing sourcemaps')
      expect(output).toContain(
        'Successfully ran the compose script for ./src/commands/react-native/__tests__/fixtures/compose-sourcemaps/main.jsbundle.map ./src/commands/react-native/__tests__/fixtures/compose-sourcemaps/MyApp.app/main.jsbundle.map ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map'
      )
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should set the USE_HERMES env variable for RN 0.70 projects using hermes', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/compose-sourcemaps',
        UNLOCALIZED_RESOURCES_FOLDER_PATH: 'MyApp.app',
        PODS_PODFILE_DIR_PATH: './src/commands/react-native/__tests__/fixtures/podfile-lock/with-hermes',
      }
      reactNativeVersionSpy.mockReturnValue('0.70.0')

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/echo_env_script.sh',
        {
          composeSourcemapsPath:
            './src/commands/react-native/__tests__/fixtures/compose-sourcemaps/compose-sourcemaps.js',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('USE_HERMES=true')
      expect(output).toContain('Hermes detected, composing sourcemaps')
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should not set the USE_HERMES env variable for RN 0.70 projects not using hermes', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/compose-sourcemaps',
        UNLOCALIZED_RESOURCES_FOLDER_PATH: 'MyApp.app',
        PODS_PODFILE_DIR_PATH: './src/commands/react-native/__tests__/fixtures/podfile-lock/without-hermes',
        USE_HERMES: 'false',
      }
      reactNativeVersionSpy.mockReturnValue('0.70.0')

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/echo_env_script.sh',
        {
          composeSourcemapsPath:
            './src/commands/react-native/__tests__/fixtures/compose-sourcemaps/compose-sourcemaps.js',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).not.toContain('USE_HERMES=true')
      expect(output).not.toContain('Hermes detected, composing sourcemaps')
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should not compose hermes sourcemaps for RN 0.71 projects', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/compose-sourcemaps',
        UNLOCALIZED_RESOURCES_FOLDER_PATH: 'MyApp.app',
        PODS_PODFILE_DIR_PATH: './src/commands/react-native/__tests__/fixtures/podfile-lock/with-hermes',
      }
      reactNativeVersionSpy.mockReturnValue('0.71.0')

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/echo_env_script.sh',
        {
          composeSourcemapsPath:
            './src/commands/react-native/__tests__/fixtures/compose-sourcemaps/compose-sourcemaps.js',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).not.toContain('Hermes detected, composing sourcemaps')
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should not bundle RN code when using hermes and building for simulator in debug mode', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION_BUILD_DIR: './src/commands/react-native/__tests__/fixtures/compose-sourcemaps',
        UNLOCALIZED_RESOURCES_FOLDER_PATH: 'MyApp.app',
        USE_HERMES: 'true',
        CONFIGURATION: 'Debug',
        PLATFORM_NAME: 'iphonesimulator',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          composeSourcemapsPath:
            './src/commands/react-native/__tests__/fixtures/compose-sourcemaps/compose-sourcemaps.js',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Skipping bundling and sourcemaps upload.')
      expect(output).not.toContain('Hermes detected, composing sourcemaps')
    })

    test('should not bundle nor upload sourcemaps when the build configuration is Debug and target is simulator', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION: 'Debug',
        PLATFORM_NAME: 'iphonesimulator',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Skipping bundling and sourcemaps upload.')
      expect(output).not.toContain('Starting successful script')
    })

    test('should bundle but not upload sourcemaps when the build configuration is Debug and target is phone', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION: 'Debug',
        PLATFORM_NAME: 'iphoneos',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Starting successful script')
      expect(output).toContain('Build configuration Debug is not Release, skipping sourcemaps upload.')
    })

    test('should bundle but not upload sourcemaps when the build configuration is Debug and user enforce bundling', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION: 'Debug',
        PLATFORM_NAME: 'iphonesimulator',
        FORCE_BUNDLING: 'true',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Starting successful script')
      expect(output).toContain('Build configuration Debug is not Release, skipping sourcemaps upload.')
    })

    test('should not bundle nor upload sourcemaps when user skips bundling', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION: 'Release',
        SKIP_BUNDLING: 'true',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Skipping bundling and sourcemaps upload.')
      expect(output).not.toContain('Starting successful script')
    })

    test('should run the provided script and upload sourcemaps when the build configuration is Debug with force option', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        CONFIGURATION: 'Debug',
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          force: true,
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('Force upload for configuration Debug')
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
    })

    test('should run the provided script and upload sourcemaps when a custom service is specified', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          service: 'com.custom',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.custom')
    })

    test.each([['PRODUCT_BUNDLE_IDENTIFIER'], ['CONFIGURATION']])(
      'should provide a custom message when %s xcode environment variable is missing',
      async (variable) => {
        process.env = {
          ...process.env,
          ...basicEnvironment,
        }
        delete process.env[variable]

        const {context, code} = await runCLI(
          './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
        )
        // Uncomment these lines for debugging failing script
        console.log(context.stdout.toString())
        console.log(context.stderr.toString())

        expect(code).toBe(1)
        const output = context.stderr.toString()
        expect(output).toContain(`Environment variable ${variable} is missing for Datadog sourcemaps upload.`)
      }
    )

    test('should provide a clear error message when the release version cannot be found', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }

      delete process.env.MARKETING_VERSION

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toContain(`Version could not be found.`)
    })

    test('should provide a clear error message when the build version cannot be found', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }

      delete process.env.CURRENT_PROJECT_VERSION

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toContain(`Build version could not be found.`)
    })

    test('should get versions from plist file even if env variables are defined', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
        PROJECT_DIR: 'src/commands/react-native/__tests__',
        INFOPLIST_FILE: 'fixtures/info-plist/Info.plist',
      }

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('version: 1.0.4 build: 12')
    })

    test('should get versions from plist file through argument if env variables are not defined', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }

      delete process.env.CURRENT_PROJECT_VERSION
      delete process.env.MARKETING_VERSION

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          infoPlistPath: 'src/commands/react-native/__tests__/fixtures/info-plist/Info.plist',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain('version: 1.0.4 build: 12')
    })

    test('should provide a clear error message when the script path is incorrect', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/non_existent.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stderr.toString()
      expect(output).toContain('Error running bundle script from datadog-ci xcode')
      expect(output).toContain(
        'Error: spawn ./src/commands/react-native/__tests__/fixtures/bundle-script/non_existent.sh ENOENT'
      )
    })

    test('should forward the error message from the script when the script fails', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/failing_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const output = context.stdout.toString()
      expect(output).toContain('[bundle script]: Starting failing script')

      const errorOutput = context.stderr.toString()
      expect(errorOutput).toContain('Error running bundle script from datadog-ci xcode.')
      expect(errorOutput).toContain('[bundle script]: Custom error message from script')
    })

    test('should provide a clear error message when no bundle file is present', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      delete process.env.CONFIGURATION_BUILD_DIR

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const errorOutput = context.stderr.toString()
      expect(errorOutput).toContain('No bundle file output has been specified')
    })

    test('should provide a clear error message when no sourcemap file is present', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      delete process.env.SOURCEMAP_FILE

      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh'
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(1)
      const errorOutput = context.stderr.toString()
      expect(errorOutput).toContain('No sourcemap output has been specified')
    })

    test('should forward arguments to upload command', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      const getRepositoryDataSpy = jest.spyOn(formatGitSourcemapsData, 'getRepositoryData')
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          configPath: './src/commands/react-native/__tests__/fixtures/config/config-with-api-key.json',
          repositoryURL: 'https://example.com',
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
      expect(getRepositoryDataSpy).toHaveBeenCalledWith(expect.anything(), 'https://example.com')
    })

    test('should disable git in upload command', async () => {
      process.env = {
        ...process.env,
        ...basicEnvironment,
      }
      const getRepositoryDataSpy = jest.spyOn(formatGitSourcemapsData, 'getRepositoryData')
      const {context, code} = await runCLI(
        './src/commands/react-native/__tests__/fixtures/bundle-script/successful_script.sh',
        {
          disableGit: true,
        }
      )
      // Uncomment these lines for debugging failing script
      console.log(context.stdout.toString())
      console.log(context.stderr.toString())

      expect(code).toBe(0)
      const output = context.stdout.toString()
      expect(output).toContain(
        'Upload of ./src/commands/react-native/__tests__/fixtures/basic-ios/main.jsbundle.map for bundle main.jsbundle on platform ios'
      )
      expect(output).toContain('version: 0.0.2 build: 000020 service: com.myapp.test')
      expect(getRepositoryDataSpy).not.toHaveBeenCalled()
    })
  })
})
