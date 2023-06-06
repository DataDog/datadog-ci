import {Command} from 'clipanion'
import deepExtend from 'deep-extend'

import {removeUndefinedValues} from '../../helpers/utils'

import {CiError} from './errors'
import {CommandConfig, MainReporter, Reporter} from './interfaces'
import {uploadMobileApplicationVersion} from './mobile'
import {DefaultReporter} from './reporters/default'
import {getReporter, reportCiError} from './utils'
import { getApiHelper } from './api'

export const DEFAULT_UPLOAD_COMMAND_CONFIG: CommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  subdomain: 'app',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: false,
  global: {},
  locations: [],
  pollingTimeout: 0,
  proxy: {protocol: 'http'},
  publicIds: [],
  tunnel: false,
  variableStrings: [],
}

export class UploadApplicationCommand extends Command {
  public configPath?: string
  private apiKey?: string
  private appKey?: string
  private config: CommandConfig = JSON.parse(JSON.stringify(DEFAULT_UPLOAD_COMMAND_CONFIG)) // Deep copy to avoid mutation during unit tests
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
      })
    )

    const api = getApiHelper(this.config)
    try {
      const version = await uploadMobileApplicationVersion(
        api,
        this.mobileApplicationVersionFilePath,
        this.mobileApplicationId,
        this.versionName,
        this.latest
      )
      this.reporter.log(`Created new version: ${version.version_name}, with version ID: ${version.id}`)
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
