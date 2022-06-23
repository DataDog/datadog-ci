// tslint:disable: no-null-keyword
import {spawn} from 'child_process'
import {Cli, Command} from 'clipanion'
import {UploadCommand} from './upload'

export class XCodeCommand extends Command {
  public static usage = Command.Usage({
    description: 'Bundle React Native code and images in XCode and send sourcemaps to Datadog.',
    details: `
            This command will bundle the react native code and images and then upload React Native sourcemaps and their corresponding javascript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.
            See README for details.
        `,
    examples: [
      [
        'Usage as XCode build phase for RN < 0.69',
        'set -e\nexport SOURCEMAP_FILE=./build/main.jsbundle.map\nexport NODE_BINARY=node\n# Replace /opt/homebrew/bin/node (resp. /opt/homebrew/bin/yarn) by the value of $(command -v node) (resp. $(command -v yarn))\n/opt/homebrew/bin/node /opt/homebrew/bin/yarn datadog-ci react-native xcode node_modules/react-native/scripts/react-native-xcode.sh\n',
      ],
      [
        'Usage as XCode build phase for RN >= 0.69',
        'set -e\nexport SOURCEMAP_FILE=./main.jsbundle.map\nWITH_ENVIRONMENT="../node_modules/react-native/scripts/xcode/with-environment.sh"\nREACT_NATIVE_XCODE="node_modules/react-native/scripts/react-native-xcode.sh"\n# Replace /opt/homebrew/bin/node (resp. /opt/homebrew/bin/yarn) by the value of $(command -v node) (resp. $(command -v yarn))\nDATADOG_XCODE="/opt/homebrew/bin/node /opt/homebrew/bin/yarn datadog-ci react-native xcode"\n\n/bin/sh -c "$WITH_ENVIRONMENT;$DATADOG_XCODE $REACT_NATIVE_XCODE" \n',
      ],
    ],
  })

  private dryRun = false
  private force = false
  private scriptPath = '../node_modules/react-native/scripts/react-native-xcode.sh'
  private service?: string = process.env.PRODUCT_BUNDLE_IDENTIFIER

  constructor() {
    super()
  }

  public async execute() {
    if (!this.service) {
      this.context.stderr.write(
        'Environment variable PRODUCT_BUNDLE_IDENTIFIER is missing for Datadog sourcemaps upload.\n'
      )
      this.context.stderr.write('Check that a Bundle Identifier is set for your target in XCode.\n')
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
    } catch (error) {
      this.context.stderr.write(`Error running bundle script from datadog-ci xcode.\n${error}`)

      return 1
    }

    if (process.env.CONFIGURATION !== 'Release' && !this.force) {
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

      return splitArguments[sourcemapsLocationIndex]
    }

    return null
  }
}

XCodeCommand.addPath('react-native', 'xcode')
XCodeCommand.addOption('scriptPath', Command.String({required: false}))
XCodeCommand.addOption('service', Command.String('--service'))
XCodeCommand.addOption('dryRun', Command.Boolean('--dry-run'))
XCodeCommand.addOption('force', Command.Boolean('--force'))
