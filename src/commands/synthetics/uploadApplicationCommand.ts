import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {removeUndefinedValues} from '../../helpers/utils'

import {CiError} from './errors'
import {UploadApplicationCommandConfig, MainReporter, Reporter} from './interfaces'
import {uploadMobileApplicationVersion} from './mobile'
import {DefaultReporter} from './reporters/default'
import {getReporter, reportCiError} from './utils'

export const DEFAULT_UPLOAD_COMMAND_CONFIG: UploadApplicationCommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  mobileApplicationVersionFilePath: '',
  mobileApplicationId: '',
  versionName: '',
  latest: false,
  files: [],
  global: {},
  locations: [],
  pollingTimeout: 0,
  publicIds: [],
  subdomain: '',
  tunnel: false,
  variableStrings: [],
  proxy: {protocol: 'http'},
}

export class UploadApplicationCommand extends Command {
  public configPath?: string
  private apiKey?: string
  private appKey?: string
  private config: UploadApplicationCommandConfig = JSON.parse(JSON.stringify(DEFAULT_UPLOAD_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests
  private datadogSite?: string
  private reporter?: MainReporter
  private mobileApplicationVersionFilePath?: string
  private mobileApplicationId?: string
  private versionName?: string
  private latest?: boolean

  public async execute() {
    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)

    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        datadogSite: process.env.DATADOG_SITE,
      })
    )

    // Override with CLI parameters
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: this.apiKey,
        appKey: this.appKey,
        datadogSite: this.datadogSite,
        mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
        mobileApplicationId: this.mobileApplicationId,
        versionName: this.versionName,
        latest: this.latest,
      })
    )

    try {
      const version = await uploadMobileApplicationVersion(this.config)
      this.reporter.log(`Created new version: ${version.versionName}, with version ID: ${version.versionId}`)
    } catch (error) {
      if (error instanceof CiError) {
        reportCiError(error, this.reporter)
      }

      return 1
    }
  }
}

UploadApplicationCommand.addPath('synthetics', 'upload-application')
UploadApplicationCommand.addOption('apiKey', Command.String('--apiKey'))
UploadApplicationCommand.addOption('appKey', Command.String('--appKey'))
UploadApplicationCommand.addOption('configPath', Command.String('--config'))
UploadApplicationCommand.addOption('datadogSite', Command.String('--datadogSite'))
UploadApplicationCommand.addOption(
  'mobileApplicationVersionFilePath',
  Command.String('--mobileApp,--mobileApplicationVersionFilePath')
)
UploadApplicationCommand.addOption('mobileApplicationId', Command.String('--mobileApplicationId'))
UploadApplicationCommand.addOption('versionName', Command.String('--versionName'))
UploadApplicationCommand.addOption('latest', Command.String('--latest'))
