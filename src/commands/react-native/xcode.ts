import {spawn} from 'child_process'
import {Command} from 'clipanion'

export class XCodeCommand extends Command {
  public static usage = Command.Usage({
    description: 'Bundle React Native code and images in XCode and send sourcemaps to Datadog.',
    details: `
            This command will bundle the react native code and images and then upload React Native sourcemaps and their corresponding javascript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.
            See README for details.
        `,
    examples: [
      ['Usage as XCode build phase', 'datadog-ci react-native xcode'],
      [
        'Usage as XCode build phase with Sentry',
        'datadog-ci react-native xcode (../node_modules/@sentry/cli/bin/sentry-cli react-native xcode ../node_modules/react-native/scripts/react-native-xcode.sh)', // TODO check it works
      ],
    ],
  })

  private scriptPath = '../node_modules/react-native/scripts/react-native-xcode.sh'
  private service: string = process.env.PRODUCT_BUNDLE_IDENTIFIER!

  constructor() {
    super()
  }

  public async execute() {
    // Check extra packager args for sourcemaps path
    // TODO

    // Run bundle script
    try {
      const bundleJSChildProcess = spawn(this.scriptPath, undefined, {
        env: process.env,
        stdio: ['inherit', 'inherit', 'pipe'],
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
        throw new Error(`error ${signal} while running script, see line above`)
      }
    } catch (error) {
      this.context.stdout.write(`Error running bundle script\n${error}`)

      return 1
    }

    if (process.env.CONFIGURATION === 'Release') {
      // Check sourcemaps have been generated
      const sourcemapsLocation = this.getSourcemapsLocation()
      const bundleLocation = this.getBundleLocation()
      // TODO

      // Get values for build
      const releaseVersion = process.env.MARKETING_VERSION!
      // TODO const buildVersion = process.env.CURRENT_PROJECT_VERSION!

      // Run upload script in the background
      this.cli.run([
        'react-native',
        'upload',
        '--platform',
        'ios',
        '--release-version',
        releaseVersion,
        '--service',
        this.service,
        '--bundle',
        bundleLocation,
        '--sourcemap',
        sourcemapsLocation,
      ])
    }

    return 0
  }

  private getBundleLocation = () => {
    if (process.env.BUNDLE_FILE) {
      return process.env.BUNDLE_FILE
    }
    if (process.env.EXTRA_PACKAGER_ARGS) {
      const splitArguments = process.env.EXTRA_PACKAGER_ARGS.split(' ')
      const bundleLocationIndex = splitArguments.findIndex((arg) => arg === '--bundle-output') + 1

      return splitArguments[bundleLocationIndex]
    }
    throw new Error('No bundle location specified')
  }

  private getSourcemapsLocation = () => {
    if (process.env.SOURCEMAP_FILE) {
      return process.env.SOURCEMAP_FILE
    }
    if (process.env.EXTRA_PACKAGER_ARGS) {
      const splitArguments = process.env.EXTRA_PACKAGER_ARGS.split(' ')
      const sourcemapsLocationIndex = splitArguments.findIndex((arg) => arg === '--sourcemap-output') + 1

      return splitArguments[sourcemapsLocationIndex]
    }
    throw new Error('No sourcemap location specified')
  }
}

XCodeCommand.addPath('react-native', 'xcode')
XCodeCommand.addOption('scriptPath', Command.String({required: false}))
XCodeCommand.addOption('service', Command.String('--service'))
