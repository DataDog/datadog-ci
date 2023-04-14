import {exec} from 'child_process'

import {Cli, Command} from 'clipanion'

import {CodepushHistoryCommandError, CodepushHistoryParseError, NoCodepushReleaseError} from './errors'
import {RNPlatform, RN_SUPPORTED_PLATFORMS} from './interfaces'
import {UploadCommand} from './upload'

export class CodepushCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload your React Native Codepush bundle and sourcemaps to Datadog.',
    details: `
      This command will upload React Native Codepush sourcemaps and their corresponding javascript bundle to Datadog in order to un-minify front-end stack traces received by Datadog.\n
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

  private appCenterAppName?: string
  private appCenterDeployment?: string
  /**
   * There should not be multiple uploads with the same version in the case
   * of codepush, so we can go with a default of "1".
   */
  private buildVersion = '1'
  private bundle?: string
  private configPath?: string
  private disableGit?: boolean
  private dryRun = false
  private maxConcurrency = 20
  private platform?: RNPlatform
  private projectPath?: string
  private releaseVersion?: string
  private removeSourcesContent?: boolean
  private repositoryURL?: string
  private service?: string
  private sourcemap?: string

  public async execute() {
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
          const history = JSON.parse(stdout)
          if (history.length === 0) {
            reject(new NoCodepushReleaseError(appCenterAppName, appCenterDeployment))
          }
          const lastDeployment = history[history.length - 1]
          const [lastCodePushLabel, _, lastVersion] = lastDeployment
          resolve(`${lastVersion}-codepush.${lastCodePushLabel}`)
        } catch (parseError) {
          reject(new CodepushHistoryParseError(`Error parsing codepush history: \n${parseError}\n${stdout}`))
        }
      })
    })
  }
}

CodepushCommand.addPath('react-native', 'codepush')
CodepushCommand.addOption('buildVersion', Command.String('--build-version'))
CodepushCommand.addOption('service', Command.String('--service'))
CodepushCommand.addOption('bundle', Command.String('--bundle'))
CodepushCommand.addOption('sourcemap', Command.String('--sourcemap'))
CodepushCommand.addOption('platform', Command.String('--platform'))
CodepushCommand.addOption('dryRun', Command.Boolean('--dry-run'))
CodepushCommand.addOption('repositoryURL', Command.String('--repository-url'))
CodepushCommand.addOption('disableGit', Command.Boolean('--disable-git'))
CodepushCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
CodepushCommand.addOption('projectPath', Command.String('--project-path'))
CodepushCommand.addOption('configPath', Command.String('--config'))
CodepushCommand.addOption('appCenterAppName', Command.String('--app'))
CodepushCommand.addOption('appCenterDeployment', Command.String('--deployment'))
CodepushCommand.addOption('removeSourcesContent', Command.Boolean('--remove-sources-content'))
