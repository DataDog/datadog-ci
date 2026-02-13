/* eslint-disable no-null/no-null */
import {spawn} from 'child_process'
import {existsSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'fs'

import {Cli, Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {parsePlist} from '@datadog/datadog-ci-base/helpers/plist'

import {ReactNativeUploadCommand} from './upload'
import {getReactNativeVersion} from './utils'

/**
 * Because jest cannot mock require.resolve, reactNativePath cannot
 * be unit tested. If you make any change to it, make sure to test
 * it with a real project.
 */
const getReactNativePath = () => {
  try {
    const indexFilePath = require.resolve('react-native')

    // We need to remove the trailing "/index.js" at the end of the path
    return indexFilePath.split('/').slice(0, -1).join('/')
  } catch (error) {
    // When the command is ran from XCode with `../node_modules/.bin/datadog-ci react-native xcode`
    if (existsSync('../node_modules/react-native/package.json')) {
      return '../node_modules/react-native'
    }

    // Used for internal testing purposes only
    if (process.env.DATADOG_CI_REACT_NATIVE_PATH) {
      return process.env.DATADOG_CI_REACT_NATIVE_PATH
    }

    // When the command is ran from XCode with yarn react-native xcode` (legacy)
    return 'node_modules/react-native'
  }
}

/**
 * Because jest cannot mock require.resolve, datadogReactNativePath cannot
 * be unit tested. If you make any change to it, make sure to test
 * it with a real project.
 */
const getDatadogReactNativePath = () => {
  try {
    const packageJsonPath = require.resolve('@datadog/mobile-react-native/package.json')

    // We need to remove the trailing "/package.json" at the end of the path
    return packageJsonPath.split('/').slice(0, -1).join('/')
  } catch (error) {
    // When the command is ran from XCode with `../node_modules/.bin/datadog-ci react-native xcode`
    if (existsSync('../node_modules/@datadog/mobile-react-native/package.json')) {
      return '../node_modules/@datadog/mobile-react-native'
    }

    // Used for internal testing purposes only
    if (process.env.DATADOG_REACT_NATIVE_PATH) {
      return process.env.DATADOG_REACT_NATIVE_PATH
    }

    // When the command is ran from XCode with yarn react-native xcode` (legacy)
    return 'node_modules/@datadog/mobile-react-native'
  }
}

export class ReactNativeXcodeCommand extends BaseCommand {
  public static paths = [['react-native', 'xcode']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Bundle React Native code and images in XCode and send sourcemaps to Datadog.',
    details: `
      This command will bundle the react native code and images and then upload React Native sourcemaps and their corresponding JavaScript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.\n
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

  private composeSourcemapsPath = Option.String(
    '--compose-sourcemaps-path',
    `${this.reactNativePath}/scripts/compose-source-maps.js`
  )
  private configPath = Option.String('--config')
  private disableGit = Option.Boolean('--disable-git')
  private dryRun = Option.Boolean('--dry-run', false)
  private force = Option.Boolean('--force', false)
  private infoPlistPath = Option.String('--info-plist-path')
  private removeSourcesContent = Option.Boolean('--remove-sources-content')
  private repositoryURL = Option.String('--repository-url')
  private service = Option.String('--service')

  private scriptPath = Option.String({required: false}) // Positional

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private _reactNativePath: string | undefined
  private _datadogReactNativePath: string | undefined
  private _defaultScriptPath: string | undefined

  private get reactNativePath() {
    if (!this._reactNativePath) {
      this._reactNativePath = getReactNativePath()
      this.verifyFolderPath(this._reactNativePath, 'DATADOG_CI_REACT_NATIVE_PATH')
    }

    return this._reactNativePath
  }

  private get datadogReactNativePath() {
    if (!this._datadogReactNativePath) {
      this._datadogReactNativePath = getDatadogReactNativePath()
      this.verifyFolderPath(this._datadogReactNativePath, 'DATADOG_REACT_NATIVE_PATH')
    }

    return this._datadogReactNativePath
  }

  private get defaultScriptPath() {
    if (!this._defaultScriptPath) {
      this._defaultScriptPath = `${this.reactNativePath}/scripts/react-native-xcode.sh`
    }

    return this._defaultScriptPath
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.service = process.env.SERVICE_NAME_IOS || this.service || process.env.PRODUCT_BUNDLE_IDENTIFIER

    if (!this.infoPlistPath && process.env.PROJECT_DIR && process.env.INFOPLIST_FILE) {
      this.infoPlistPath = `${process.env.PROJECT_DIR}/${process.env.INFOPLIST_FILE}`
    }

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

    const releaseVersion = this.getReleaseVersion()
    const buildVersion = this.getBuildVersion()
    if (releaseVersion === null || buildVersion === null) {
      return 1
    }

    // Run bundle script
    try {
      if (!this.shouldBundleRNCode()) {
        this.context.stdout.write(`Skipping bundling and sourcemaps upload.`)

        return 0
      }

      await this.bundleReactNativeCodeAndImages()

      if (!this.shouldUploadSourcemaps()) {
        this.context.stdout.write(
          `Build configuration ${process.env.CONFIGURATION} is not Release, skipping sourcemaps upload.`
        )

        return 0
      }

      /**
       * Because of a bug in React Native (https://github.com/facebook/react-native/issues/34212), the composition
       * of the 2 Hermes sourcemaps is not done correctly. Therefore we need to do the composition ourselves to
       * overwrite the sourcemaps before the upload
       */
      if (this.shouldComposeHermesSourcemaps()) {
        this.context.stdout.write('Hermes detected, composing sourcemaps')
        await this.composeHermesSourcemaps(sourcemapsLocation)
      }

      /**
       * If Hermes is enabled, we need to copy the debug ID from the bundle file to the composed sourcemaps file.
       */
      if (this.isHermesEnabled()) {
        this.context.stdout.write(`\nHermes is enabled, trying to copy debug ID to composed sourcemaps.`)

        // Copy debug ID from the bundle to the sourcemaps location
        if (!this.copyDebugIdFromBundle(bundleLocation, sourcemapsLocation)) {
          // Try to copy debug ID from the temporary file generated by Datadog Metro Plugin as a fallback
          this.copyDebugIdFromTempFile(sourcemapsLocation)
        }
      }
    } catch (error) {
      this.context.stderr.write(`Error running bundle script from datadog-ci xcode.\n${String(error)}`)

      return 1
    }

    if (this.force) {
      this.context.stdout.write(`Force upload for configuration ${process.env.CONFIGURATION}`)
    }

    // Run upload script in the background
    const cli = new Cli()
    cli.register(ReactNativeUploadCommand)

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
    if (this.configPath) {
      uploadCommand.push('--config', this.configPath)
    }
    if (this.disableGit) {
      uploadCommand.push('--disable-git')
    }
    if (this.repositoryURL) {
      uploadCommand.push('--repository-url', this.repositoryURL)
    }
    if (this.removeSourcesContent) {
      uploadCommand.push('--remove-sources-content')
    }
    if (this.dryRun) {
      uploadCommand.push('--dry-run')
    }

    return cli.run(uploadCommand, this.context)
  }

  /**
   * Resolves the Debug ID from the bundle file and writes it into the sourcemap.
   */
  private copyDebugIdFromBundle = (bundleLocation: string, sourcemapsLocation: string): boolean => {
    try {
      const bundleContent = readFileSync(bundleLocation, 'utf8')
      const match = bundleContent.match(/\/\/# debugId=([a-f0-9-]+)/i)
      const debugId = match ? match[1] : undefined
      if (!debugId) {
        this.context.stderr.write('\nDebug ID not found in bundle.\n')

        return false
      }

      this.context.stdout.write(`\nFound debug ID in bundle. Copying to sourcemap.\n`)

      return this.writeDebugIdInSourcemap(sourcemapsLocation, debugId)
    } catch (error) {
      this.context.stderr.write(`\nError reading bundle file: ${String(error)}\n`)

      return false
    }
  }

  /**
   * Fallback method to copy the debug ID from the temporary file created by the Metro plugin.
   * This is used when the debug ID is not found in the bundle file.
   */
  private copyDebugIdFromTempFile = (sourcemapsLocation: string): boolean => {
    const debugIdFilePath = `${this.datadogReactNativePath}/.tmp/debug_id`

    if (!existsSync(debugIdFilePath)) {
      this.context.stderr.write(`\nDebug ID temporary file not found in ${debugIdFilePath}. Skipping copy.\n`)

      return false
    }

    let debugId: string
    try {
      debugId = readFileSync(debugIdFilePath, 'utf-8').trim()
    } catch (error) {
      this.context.stderr.write(`\nError reading debug ID file: ${String(error)}\n`)

      return false
    } finally {
      try {
        this.context.stdout.write(`\nRemoving debug ID file at ${debugIdFilePath}\n`)
        unlinkSync(debugIdFilePath)
      } catch (error) {
        this.context.stderr.write(`\nError removing debug ID file: ${String(error)}\n`)
      }
    }

    if (!debugId || debugId.trim() === '') {
      this.context.stderr.write('\nDebug ID file is empty. Skipping copy.\n')

      return false
    }

    this.context.stdout.write(`\nFound debug ID in ${debugIdFilePath}.\n`)

    const success = this.writeDebugIdInSourcemap(sourcemapsLocation, debugId)
    if (!success) {
      this.context.stderr.write('\nFailed to write debug ID into sourcemap.\n')
    }

    return success
  }

  /**
   * Writes the debug ID into the sourcemap file.
   * If the sourcemap already contains a debug ID, it will skip the update unless `force` is true.
   * If the debug ID in the sourcemap does not match the provided debug ID, it will log a warning.
   */
  private writeDebugIdInSourcemap = (sourcemapsLocation: string, debugId: string, force = false): boolean => {
    try {
      const sourcemapFile = readFileSync(sourcemapsLocation, 'utf-8')
      const sourcemap = JSON.parse(sourcemapFile) as {debugId?: string}

      if (sourcemap.debugId && sourcemap.debugId.trim() !== '' && !force) {
        this.context.stdout.write(`\nSourcemap already contains a debugId: ${sourcemap.debugId}. Skipping update.\n`)

        if (sourcemap.debugId !== debugId) {
          this.context.stderr.write(
            `\nWARNING: The existing debugId (${sourcemap.debugId}) does not match the resolved debugId (${debugId}).
            \nThis should never occur, please open an issue at https://github.com/DataDog/datadog-ci/issues/new?template=BUG_REPORT.yml`
          )
        }

        return true
      }

      sourcemap.debugId = debugId

      this.context.stdout.write(`\nAdding debugId ${debugId} to the sourcemap at ${sourcemapsLocation}\n`)
      writeFileSync(sourcemapsLocation, JSON.stringify(sourcemap))
    } catch (error) {
      this.context.stderr.write(`\nError writing debugId to sourcemap: ${String(error)}\n`)

      return false
    }

    return true
  }

  private bundleReactNativeCodeAndImages = async () => {
    const bundleJSChildProcess = spawn(this.scriptPath || this.defaultScriptPath, [], {
      env: this.getBundleReactNativeCodeAndImagesEnvironment(),
      stdio: ['inherit', 'pipe', 'pipe'],
    })
    bundleJSChildProcess.stdout.on('data', (data) => {
      this.context.stdout.write(`[bundle script]: ${String(data)}`)
    })
    bundleJSChildProcess.stderr.on('data', (data) => {
      this.context.stderr.write(`[bundle script]: ${String(data)}`)
    })

    const [status, signal] = await new Promise<[number, string]>((resolve, reject) => {
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

  private getBundleReactNativeCodeAndImagesEnvironment = () => {
    const env = process.env

    /**
     * On React Native 0.70, we need to explicitely set USE_HERMES to true
     * if Hermes is used, otherwise the source maps won't be generated.
     * See the fix for next releases: https://github.com/facebook/react-native/commit/03de19745eec9a0d4d1075bac48639ecf1d41352
     */
    if (this.shouldComposeHermesSourcemaps()) {
      env.USE_HERMES = 'true'
    }

    return env
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

    const [status, signal] = await new Promise<[number, string]>((resolve, reject) => {
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

  private getBuildVersion = (): string | null => {
    try {
      const buildVersion = this.getPlistValue('CFBundleVersion')

      return typeof buildVersion === 'number' ? buildVersion.toString() : buildVersion
    } catch (error) {
      if (!process.env.CURRENT_PROJECT_VERSION) {
        this.context.stderr.write('Build version could not be found.\n')
        this.context.stderr.write(
          'Check that a Build is set for your target in XCode. It might need to be changed once.\n'
        )
        if (this.infoPlistPath) {
          this.context.stderr.write(
            `You can also check that a CFBundleVersion is defined in your Info.plist at ${this.infoPlistPath}.\n`
          )
        }
        this.context.stderr.write(
          'If you are not running this script from XCode, set a CURRENT_PROJECT_VERSION environment variable before running the script.\n'
        )

        return null
      }
    }

    return process.env.CURRENT_PROJECT_VERSION
  }

  private getBundleLocation = () => {
    if (!process.env.CONFIGURATION_BUILD_DIR) {
      return null
    }

    return `${process.env.CONFIGURATION_BUILD_DIR}/main.jsbundle`
  }

  private getPlistValue = (propertyName: string): string | number => {
    if (!this.infoPlistPath) {
      throw new Error('Could not find plist path')
    }

    return parsePlist(this.infoPlistPath).getPropertyValue(propertyName)
  }

  private getReleaseVersion = (): string | null => {
    if (process.env.DATADOG_RELEASE_VERSION) {
      return process.env.DATADOG_RELEASE_VERSION
    }

    try {
      const releaseVersion = this.getPlistValue('CFBundleShortVersionString')

      return typeof releaseVersion === 'number' ? releaseVersion.toString() : releaseVersion
    } catch (error) {
      if (!process.env.MARKETING_VERSION) {
        this.context.stderr.write('Version could not be found.\n')
        this.context.stderr.write(
          'Check that a Version is set for your target in XCode. It might need to be changed once.\n'
        )
        if (this.infoPlistPath) {
          this.context.stderr.write(
            `You can also check that a CFBundleShortVersionString is defined in your Info.plist at ${this.infoPlistPath}.\n`
          )
        }
        this.context.stderr.write(
          'If you are not running this script from XCode, set a MARKETING_VERSION environment variable before running the script.\n'
        )

        return null
      }
    }

    return process.env.MARKETING_VERSION
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
   * return false if the React Native version is at least 0.71 where it was fixed.
   */
  private shouldComposeHermesSourcemaps = (): boolean => {
    /**
     * We start by checking if the version is over 0.70, as the bug
     * is fixed from react-native 0.71.0
     */
    const reactNativeVersion = getReactNativeVersion(`${this.reactNativePath}/package.json`)
    if (!reactNativeVersion) {
      return false
    }
    const [_, minor] = reactNativeVersion.split('.')
    if (Number(minor) > 70) {
      return false
    }

    /**
     * This env variable is empty by default.
     * Before RN 0.70, it had to be set to `true` for Hermes to be used.
     * Since RN 0.70, Hermes is enabled even if it is empty.
     */
    if (process.env.USE_HERMES) {
      return process.env.USE_HERMES.toLowerCase() !== 'false'
    }

    /**
     * Check if hermes pod is present in pods.
     * This is the check used until RN 0.70, but the architecture of the pod might change,
     * so it's best not to rely on it to detect if Hermes is disabled.
     */
    if (existsSync(`${process.env.PODS_ROOT}/hermes-engine/destroot/bin/hermesc`)) {
      return true
    }

    return this.isHermesEnabled()
  }

  private isHermesEnabled = (): boolean => {
    /**
     * Checks if Hermes is in the Podfile.lock.
     * This is the most recent check for detecting Hermes in the `react-native-xcode.sh` script:
     * https://github.com/facebook/react-native/commit/8745a148b6d8358702b5300d73f4686c3aedb413
     *
     * If the Podfile.lock cannot be found, we assume Hermes is not enabled
     */
    const podfileLockPath = `${process.env.PODS_PODFILE_DIR_PATH}/Podfile.lock`
    if (!existsSync(podfileLockPath)) {
      return false
    }
    const podfileLockContent = readFileSync(podfileLockPath).toString()

    return !!podfileLockContent.match('hermes-engine')
  }

  private shouldUploadSourcemaps = (): boolean => {
    // If we did not bundle the RN code, we won't have anything to upload.
    if (!this.shouldBundleRNCode()) {
      return false
    }

    if (this.force) {
      return true
    }

    // We don't upload sourcemaps if the configuration is "Debug"
    return !process.env.CONFIGURATION?.includes('Debug')
  }

  private shouldBundleRNCode = (): boolean => {
    if (this.force) {
      return true
    }

    // We keep the same logic and order than react-native-xcode.sh script from RN.
    if (!!process.env.SKIP_BUNDLING) {
      return false
    }
    if (process.env.CONFIGURATION?.includes('Debug')) {
      // We don't build for simulators in debug mode but we do for real devices.
      // See https://github.com/DataDog/expo-datadog/issues/31
      if (process.env.PLATFORM_NAME?.includes('simulator')) {
        return !!process.env.FORCE_BUNDLING
      }
    }

    return true
  }

  private verifyFolderPath(folderPath: string, envVariableName?: string): boolean {
    const fallbackMessage = envVariableName
      ? `You can override the path by setting the ENV variable: ${envVariableName}`
      : ''
    if (!existsSync(folderPath)) {
      this.context?.stderr?.write(`\nResolved path does not exist: ${folderPath}.` + fallbackMessage)

      return false
    }

    if (!statSync(folderPath).isDirectory()) {
      this.context?.stderr?.write(`\nResolved path is not a directory: ${folderPath}.` + fallbackMessage)

      return false
    }

    return true
  }
}
