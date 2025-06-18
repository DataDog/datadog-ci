import {exec} from 'child_process'

import {Cli, Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-core/constants'
import {toBoolean} from '@datadog/datadog-ci-core/helpers/env'
import {enableFips} from '@datadog/datadog-ci-core/helpers/fips'

import {CodepushHistoryCommandError, CodepushHistoryParseError, NoCodepushReleaseError} from './errors'
import {RNPlatform, RN_SUPPORTED_PLATFORMS} from './interfaces'
import {UploadCommand} from './upload'
import {sanitizeReleaseVersion} from './utils'

export class CodepushCommand extends Command {
  public static paths = [['react-native', 'codepush']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload your React Native Codepush bundle and sourcemaps to Datadog.',
    details: `
      This command will upload React Native Codepush sourcemaps and their corresponding JavaScript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.\n
      See README for details.
    `,
    examples: [
      [
        'Upload ios staging sourcemaps for Company/AppNameiOS',
        'datadog-ci react-native codepush --platform ios --service com.company.app --bundle ./build/main.jsbundle --sourcemap ./build/main.jsbundle.map --app Company/AppNameiOS --deployment Staging',
      ],
      [
        'Upload android production sourcemaps for Company/AppNameAndroid',
        'datadog-ci react-native codepush --platform android --service com.company.app --bundle ./build/index.android.bundle --sourcemap ./build/index.android.bundle.map --app Company/AppNameAndroid --deployment Production',
      ],
    ],
  })

  private appCenterAppName = Option.String('--app')
  private appCenterDeployment = Option.String('--deployment')
  /**
   * There should not be multiple uploads with the same version in the case
   * of codepush, so we can go with a default of "1".
   */
  private buildVersion = Option.String('--build-version', '1')
  private bundle = Option.String('--bundle')
  private configPath = Option.String('--config')
  private disableGit = Option.Boolean('--disable-git')
  private dryRun = Option.Boolean('--dry-run', false)
  private maxConcurrency = Option.String('--max-concurrency', '20')
  private platform?: RNPlatform = Option.String('--platform')
  private projectPath = Option.String('--project-path')
  private removeSourcesContent = Option.Boolean('--remove-sources-content')
  private repositoryURL = Option.String('--repository-url')
  private service = Option.String('--service')
  private sourcemap = Option.String('--sourcemap')

  private releaseVersion?: string

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private config = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    if (!this.platform) {
      this.context.stderr.write('Missing platform\n')

      return 1
    }

    if (!RN_SUPPORTED_PLATFORMS.includes(this.platform)) {
      this.context.stderr.write(
        `Platform ${this.platform} is not supported.\nSupported platforms are ios and android.\n`
      )

      return 1
    }

    if (!this.sourcemap) {
      this.context.stderr.write('Missing sourcemap file path\n')

      return 1
    }

    if (!this.appCenterAppName) {
      this.context.stderr.write('Missing AppCenter app name\n')

      return 1
    }

    if (!this.appCenterDeployment) {
      this.context.stderr.write('Missing AppCenter deployment\n')

      return 1
    }

    this.releaseVersion = await this.getReleaseVersionFromCodepushHistory(
      this.appCenterAppName,
      this.appCenterDeployment
    )

    // Run upload script in the background
    const cli = new Cli()
    cli.register(UploadCommand)

    const uploadCommand = [
      'react-native',
      'upload',
      '--platform',
      this.platform,
      '--release-version',
      this.releaseVersion,
      '--build-version',
      this.buildVersion,
      '--service',
      this.service,
      '--sourcemap',
      this.sourcemap,
    ]
    if (this.bundle) {
      uploadCommand.push('--bundle', this.bundle)
    }
    if (this.configPath) {
      uploadCommand.push('--config')
      uploadCommand.push(this.configPath)
    }
    if (this.maxConcurrency) {
      uploadCommand.push('--max-concurrency')
      uploadCommand.push(this.maxConcurrency.toString())
    }
    if (this.projectPath) {
      uploadCommand.push('--project-path')
      uploadCommand.push(this.projectPath)
    }
    if (this.repositoryURL) {
      uploadCommand.push('--repository-url')
      uploadCommand.push(this.repositoryURL)
    }
    if (this.disableGit) {
      uploadCommand.push('--disable-git')
    }
    if (this.removeSourcesContent) {
      uploadCommand.push('--remove-sources-content')
    }
    if (this.dryRun) {
      uploadCommand.push('--dry-run')
    }

    return cli.run(uploadCommand, this.context)
  }

  private getReleaseVersionFromCodepushHistory = async (
    appCenterAppName: string,
    appCenterDeployment: string
  ): Promise<string> => {
    const command = `appcenter codepush deployment history ${appCenterDeployment} --app ${appCenterAppName} --output json`

    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(new CodepushHistoryCommandError(stderr, command))

          return
        }
        try {
          const history = JSON.parse(stdout) as any[]
          if (history.length === 0) {
            reject(new NoCodepushReleaseError(appCenterAppName, appCenterDeployment))
          }
          const lastDeployment = history[history.length - 1] as [string, string, string]
          const [lastCodePushLabel, _, lastVersion] = lastDeployment

          const version = sanitizeReleaseVersion(lastVersion)
          if (/^[^\d]/.test(version)) {
            reject(
              new CodepushHistoryParseError(`Error parsing codepush history: invalid version string '${lastVersion}'`)
            )
          }

          resolve(`${version}-codepush.${lastCodePushLabel}`)
        } catch (parseError) {
          reject(new CodepushHistoryParseError(`Error parsing codepush history: \n${String(parseError)}\n${stdout}`))
        }
      })
    })
  }
}
