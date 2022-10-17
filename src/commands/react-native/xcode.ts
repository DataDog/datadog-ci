/* eslint-disable no-null/no-null */
import {spawn} from 'child_process'
import {existsSync} from 'fs'
import {sep} from 'path'

import {Cli, Command} from 'clipanion'

import {UploadCommand} from './upload'

/**
 * Because jest cannot mock require.resolve, reactNativePath cannot
 * be unit tested. If you make any change to it, make sure to test
 * it with a real project.
 */
const reactNativePath = (() => {
  try {
    const reactNativeIndexFile = require.resolve('react-native')

    // We need to remove the trailing "/index.js" at the end of the path
    return reactNativeIndexFile.split(sep).slice(0, -1).join(sep)
  } catch (error) {
    return 'node_modules/react-native'
  }
})()

export class XCodeCommand extends Command {
  public static usage = Command.Usage({
    description: 'Bundle React Native code and images in XCode and send sourcemaps to Datadog.',
    details: `
      This command will bundle the react native code and images and then upload React Native sourcemaps and their corresponding javascript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Usage as XCode build phase for RN < 0.69',
        'set -e\nexport SOURCEMAP_FILE=./build/main.jsbundle.map\nexport NODE_BINARY=node\n# Replace /opt/homebrew/bin/node (resp. /opt/homebrew/bin/yarn) by the value of $(command -v node) (resp. $(command -v yarn))\n/opt/homebrew/bin/node /opt/homebrew/bin/yarn datadog-ci react-native xcode node_modules/react-native/scripts/react-native-xcode.sh\n',
      ],
      [
        'Usage as XCode build phase for RN >= 0.69',
        'set -e\nexport SOURCEMAP_FILE=./main.jsbundle.map\nWITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"\nREACT_NATIVE_XCODE="./datadog-sourcemaps.sh"\n\n/bin/sh -c "$WITH_ENVIRONMENT $REACT_NATIVE_XCODE"\n',
      ],
    ],
  })

  private composeSourcemapsPath = `${reactNativePath}/scripts/compose-source-maps.js`
  private dryRun = false
  private force = false
  private scriptPath = `${reactNativePath}/scripts/react-native-xcode.sh`
  private service?: string = process.env.PRODUCT_BUNDLE_IDENTIFIER

  constructor() {
    super()
  }

  public async execute() {
    this.service = process.env.SERVICE_NAME_IOS || this.service
    if (!this.service) {
      this.context.stderr.write(
        'Environment variable PRODUCT_BUNDLE_IDENTIFIER is missing for Datadog sourcemaps upload.\n'
      )
      this.context.stderr.write('Check that a Bundle Identifier is set for your target in XCode.\n')
      this.context.stderr.write('You can also specify the service as the SERVICE_NAME_IOS environment variable.\n')
      this.context.stderr.write(
        'If you are not running this script from XCode, use the `--service com.company.app` argument.\n'
      )

      return 1
    }

    if (!process.env.CONFIGURATION) {
      this.context.stderr.write('Environment variable CONFIGURATION is missing for Datadog sourcemaps upload.\n')
      this.context.stderr.write(
        'If you are not running this script from XCode, you can force the sourcemaps upload with a --force argument.\n'
      )

      return 1
    }

    if (!process.env.MARKETING_VERSION) {
      this.context.stderr.write('Environment variable MARKETING_VERSION is missing for Datadog sourcemaps upload.\n')
      this.context.stderr.write('Check that a Version is set for your target in XCode. It needs to be changed once.\n')
      this.context.stderr.write(
        'If you are not running this script from XCode, set a MARKETING_VERSION environment variable before running the script.\n'
      )

      return 1
    }

    if (!process.env.CURRENT_PROJECT_VERSION) {
      this.context.stderr.write(
        'Environment variable CURRENT_PROJECT_VERSION is missing for Datadog sourcemaps upload.\n'
      )
      this.context.stderr.write('Check that a Build is set for your target in XCode. It needs to be changed once.\n')
      this.context.stderr.write(
        'If you are not running this script from XCode, set a CURRENT_PROJECT_VERSION environment variable before running the script.\n'
      )

      return 1
    }
    const sourcemapsLocation = this.getSourcemapsLocation()
    if (!sourcemapsLocation) {
      this.context.stderr.write('No sourcemap output has been specified.\n')
      this.context.stderr.write(
        'Check that you either set a SOURCEMAP_FILE or an EXTRA_PACKAGER_ARGS environment variable in your "Bundle React Native code and images" Build Phase in XCode.\n'
      )
      this.context.stderr.write(
        'If you are not running this script from XCode, set a SOURCEMAP_FILE environment variable before running the script.\n'
      )

      return 1
    }

    const bundleLocation = this.getBundleLocation()
    if (!bundleLocation) {
      this.context.stderr.write('No bundle file output has been specified.\n')
      this.context.stderr.write(
        'If you are not running this script from XCode, set a CONFIGURATION_BUILD_DIR (directory containing the generated bundle) environment variable before running the script.\n'
      )

      return 1
    }

    // Run bundle script
    try {
      await this.bundleReactNativeCodeAndImages()

      /**
       * Because of a bug in React Native (https://github.com/facebook/react-native/issues/34212), the composition
       * of the 2 Hermes sourcemaps is not done correctly. Therefore we need to do the composition ourselves to
       * overwrite the sourcemaps before the upload
       */
      if (this.shouldComposeHermesSourcemaps()) {
        this.context.stdout.write('Hermes detected, composing sourcemaps')
        await this.composeHermesSourcemaps(sourcemapsLocation)
      }
    } catch (error) {
      this.context.stderr.write(`Error running bundle script from datadog-ci xcode.\n${error}`)

      return 1
    }

    if (!this.shouldUploadSourcemaps()) {
      this.context.stdout.write(
        `Build configuration ${process.env.CONFIGURATION} is not Release, skipping sourcemaps upload`
      )

      return 0
    }
    if (this.force) {
      this.context.stdout.write(`Force upload for configuration Debug ${process.env.CONFIGURATION}`)
    }
    // Get values for build
    const releaseVersion = process.env.MARKETING_VERSION
    const buildVersion = process.env.CURRENT_PROJECT_VERSION

    // Run upload script in the background
    const cli = new Cli()
    cli.register(UploadCommand)

    const uploadCommand = [
      'react-native',
      'upload',
      '--platform',
      'ios',
      '--release-version',
      releaseVersion,
      '--build-version',
      buildVersion,
      '--service',
      this.service,
      '--bundle',
      bundleLocation,
      '--sourcemap',
      sourcemapsLocation,
    ]
    if (this.dryRun) {
      uploadCommand.push('--dry-run')
    }

    return cli.run(uploadCommand, this.context)
  }

  private bundleReactNativeCodeAndImages = async () => {
    const bundleJSChildProcess = spawn(this.scriptPath, undefined, {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    bundleJSChildProcess.stdout.on('data', (data) => {
      this.context.stdout.write(`[bundle script]: ${data}`)
    })
    bundleJSChildProcess.stderr.on('data', (data) => {
      this.context.stderr.write(`[bundle script]: ${data}`)
    })

    const [status, signal] = await new Promise((resolve, reject) => {
      bundleJSChildProcess.on('error', (error: Error) => {
        reject(error)
      })

      bundleJSChildProcess.on('close', (exitStatus: number, exitSignal: string) => {
        resolve([exitStatus, exitSignal])
      })
    })

    if (status !== 0) {
      throw new Error(`error ${signal} while running datadog-ci xcode.`)
    }
  }

  private composeHermesSourcemaps = async (sourcemapsLocation: string) => {
    if (!process.env.UNLOCALIZED_RESOURCES_FOLDER_PATH) {
      this.context.stderr.write(
        'Environment variable UNLOCALIZED_RESOURCES_FOLDER_PATH is missing for Datadog sourcemaps composition.\n'
      )
      this.context.stderr.write(
        'If you are not running this script from XCode, set it to the subfolder containing the hbc sourcemap.\n'
      )

      throw new Error(
        'Environment variable UNLOCALIZED_RESOURCES_FOLDER_PATH is missing for Datadog sourcemaps composition.'
      )
    }

    const composeHermesSourcemapsChildProcess = spawn(
      this.composeSourcemapsPath,
      [
        `${process.env.CONFIGURATION_BUILD_DIR}/main.jsbundle.map`,
        `${process.env.CONFIGURATION_BUILD_DIR}/${process.env.UNLOCALIZED_RESOURCES_FOLDER_PATH}/main.jsbundle.map`,
        '-o',
        sourcemapsLocation,
      ],
      {
        env: process.env,
        stdio: ['inherit', 'pipe', 'pipe'],
      }
    )
    composeHermesSourcemapsChildProcess.stdout.on('data', (data) => {
      this.context.stdout.write(`[compose sourcemaps script]: ${data}`)
    })
    composeHermesSourcemapsChildProcess.stderr.on('data', (data) => {
      this.context.stderr.write(`[compose sourcemaps script]: ${data}`)
    })

    const [status, signal] = await new Promise((resolve, reject) => {
      composeHermesSourcemapsChildProcess.on('error', (error: Error) => {
        reject(error)
      })

      composeHermesSourcemapsChildProcess.on('close', (exitStatus: number, exitSignal: string) => {
        resolve([exitStatus, exitSignal])
      })
    })

    if (status !== 0) {
      throw new Error(`error ${signal} while running datadog-ci xcode.`)
    }
  }

  private getBundleLocation = () => {
    if (!process.env.CONFIGURATION_BUILD_DIR) {
      return null
    }

    return `${process.env.CONFIGURATION_BUILD_DIR}/main.jsbundle`
  }

  private getSourcemapsLocation = () => {
    if (process.env.SOURCEMAP_FILE) {
      return `${process.env.SOURCEMAP_FILE}`
    }
    if (process.env.EXTRA_PACKAGER_ARGS) {
      const splitArguments = process.env.EXTRA_PACKAGER_ARGS.split(' ')
      const sourcemapsLocationIndex = splitArguments.findIndex((arg) => arg === '--sourcemap-output') + 1
      if (sourcemapsLocationIndex === 0) {
        return null
      }

      return splitArguments[sourcemapsLocationIndex]
    }

    return null
  }

  /**
   * This function reflects the logic in the react-native-xcode.sh bundle script.
   * When the composition issue is fixed in React Native, this function should
   * return false if the React Native version is high enough.
   */
  private shouldComposeHermesSourcemaps = (): boolean => {
    if (process.env.USE_HERMES) {
      return true
    }
    if (process.env.HERMES_CLI_PATH) {
      return true
    }

    // Check if hermes pod is present
    return existsSync(`${process.env.PODS_ROOT}/hermes-engine/destroot/bin/hermesc`)
  }

  private shouldUploadSourcemaps = (): boolean => process.env.CONFIGURATION === 'Release' || this.force
}

XCodeCommand.addPath('react-native', 'xcode')
XCodeCommand.addOption('scriptPath', Command.String({required: false}))
XCodeCommand.addOption('service', Command.String('--service'))
XCodeCommand.addOption('dryRun', Command.Boolean('--dry-run'))
XCodeCommand.addOption('force', Command.Boolean('--force'))
XCodeCommand.addOption('composeSourcemapsPath', Command.String('--compose-sourcemaps-path'))
