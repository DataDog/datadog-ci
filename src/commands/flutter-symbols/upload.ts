// Disabling no-unused-variable temporarily so certain private methods
// can remain in while this feature is in progress
// tslint:disable: no-unused-variable
import fs from 'fs'

import {Command} from 'clipanion'
import yaml from 'js-yaml'
import {
  renderArgumentMissingError,
  renderDartSymbolsLocationRequiredError,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidPubspecError,
  renderMissingAndroidMappingFile,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
} from './renderer'

import glob from 'glob'
import {newApiKeyValidator} from '../../helpers/apikey'
import {getBaseSourcemapIntakeUrl} from '../../helpers/base-intake-url'
import {getRepositoryData, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {getMetricsLogger} from '../../helpers/metrics'
import {MultipartPayload, MultipartValue} from '../../helpers/upload'
import {
  buildPath,
  DEFAULT_CONFIG_PATH,
  getRequestBuilder,
  performSubCommand,
  resolveConfigFromFile,
} from '../../helpers/utils'
import * as dsyms from '../dsyms/upload'
import {newSimpleGit} from '../git-metadata/git'
import {getFlutterRequestBuilder, uploadMultipartHelper} from './helpers'
import {MappingMetadata, MAPPING_TYPE_JVM_MAPPING} from './interfaces'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: '',
    details: `
        `,
    examples: [],
  })

  private androidMapping = false
  private androidMappingLocation?: string
  private cliVersion: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSite: process.env.DATADOG_SITE || 'datadoghq.com',
  }
  private configPath?: string
  private dartSymbols = false
  private dartSymbolsLocation?: string
  private disableGit = false
  private dryRun = false
  private flavor = 'release'
  private gitData?: RepositoryData
  private iosDsyms = false
  private iosDsymsLocation?: string
  private pubspecLocation = './pubspec.yaml'
  private repositoryUrl?: string
  private serviceName!: string
  private version?: string

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
  }

  public async execute() {
    if (!(await this.verifyParameters())) {
      return 1
    }

    this.config = await resolveConfigFromFile(this.config, {
      configPath: this.configPath,
      defaultConfigPath: DEFAULT_CONFIG_PATH,
    })

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
    }

    try {
      if (this.iosDsyms || this.iosDsymsLocation) {
        await this.performDsymUpload()
      }
      if (this.androidMapping || this.androidMappingLocation) {
        await this.performAndroidMappingUpload()
      }

      return 0
    } catch (e) {
      renderGeneralizedError(e)
    }

    return 1
  }

  private createAndroidMappingPayload(mappingFile: string): MultipartPayload {
    const metadata = this.getAndroidMetadata()

    const content = new Map<string, MultipartValue>([
      [
        'event',
        {
          options: {
            contentType: 'application/json',
            filename: 'event',
          },
          value: JSON.stringify(metadata),
        },
      ],
    ])

    return {
      content,
    }
  }

  private getAndroidMetadata(): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      service: this.serviceName,
      type: MAPPING_TYPE_JVM_MAPPING,
      variant: this.flavor,
      version: this.version!,
    }
  }

  private getFlutterSymbolFiles(dartSymbolLocation: string): string[] {
    const symbolPaths = glob.sync(buildPath(dartSymbolLocation, '*.symbols'))

    return symbolPaths
  }

  private getGitDataPayload(): MultipartValue | undefined {
    if (this.gitData === undefined) {
      return undefined
    }

    const files = this.gitData.trackedFilesMatcher.rawTrackedFilesList()
    const repoPayload = {
      data: [
        {
          files,
          hash: this.gitData.hash,
          repository_url: this.gitData.remote,
        },
      ],
      version: 1,
    }

    return {
      options: {filename: 'repository', contentType: 'application/json'},
      value: JSON.stringify(repoPayload),
    }
  }

  private async getGitMetadata(): Promise<RepositoryData | undefined> {
    try {
      return await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }

    return undefined
  }

  private async parsePubspec(pubspecLocation: string): Promise<number> {
    if (!fs.existsSync(pubspecLocation)) {
      this.context.stderr.write(renderMissingPubspecError(pubspecLocation))

      return 1
    }

    try {
      const doc = yaml.load(fs.readFileSync(pubspecLocation, 'utf8')) as any
      if (doc.version) {
        this.version = doc.version
      } else {
        this.context.stderr.write(renderPubspecMissingVersionError(pubspecLocation))

        return 1
      }
    } catch (e) {
      this.context.stderr.write(renderInvalidPubspecError(pubspecLocation))

      return 1
    }

    return 0
  }

  private async performAndroidMappingUpload(): Promise<number> {
    const androidMetadata = this.getAndroidMetadata()

    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [
        `version:${this.version}`,
        `service:${this.serviceName}`,
        `cli_version:${this.cliVersion}`,
        'flutter:true',
        'platform:android',
      ],
      prefix: 'datadog.ci.symbols.upload.',
    })

    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })

    const requestBuilder = getFlutterRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    if (this.dryRun) {
      return 0
    }

    const metadata = this.getAndroidMetadata()

    const payload = {
      content: new Map<string, MultipartValue>([
        ['event', {value: JSON.stringify(metadata), options: {filename: 'event', contentType: 'application/json'}}],
        [
          'jvm_mapping',
          {value: fs.createReadStream(this.androidMappingLocation!), options: {filename: 'jvm_mapping_file'}},
        ],
      ]),
    }
    if (this.gitData !== undefined) {
      payload.content.set('repository', this.getGitDataPayload()!)
    }

    return uploadMultipartHelper(requestBuilder, payload, {
      apiKeyValidator,
      // tslint:disable-next-line:no-empty
      onError: (e) => {},
      // tslint:disable-next-line:no-empty
      onRetry: (e, attempts) => {},
      // tslint:disable-next-line:no-empty
      onUpload: () => {},
      retries: 5,
    })
  }

  private async performDsymUpload() {
    const symbolLocation = this.iosDsymsLocation ?? './build/ios/archive/Runner.xcarchive/dSYMs'

    const dsymUploadCommand = ['dsyms', 'upload', symbolLocation]
    if (this.dryRun) {
      dsymUploadCommand.push('--dry-run')
    }

    const exitCode = await performSubCommand(dsyms.UploadCommand, dsymUploadCommand, this.context)
    if (exitCode && exitCode !== 0) {
      throw new Error(`recieved exit code ${exitCode} while dsym upload.`)
    }
  }

  private async verifyParameters(): Promise<boolean> {
    if (!this.serviceName) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))

      return false
    }

    if (this.dartSymbols && !this.dartSymbolsLocation) {
      this.context.stderr.write(renderDartSymbolsLocationRequiredError())

      return false
    }

    if (this.androidMapping && !this.androidMappingLocation) {
      this.androidMappingLocation = `./build/app/outputs/mapping/${this.flavor}/mapping.txt`
    }

    if (this.androidMappingLocation) {
      if (!fs.existsSync(this.androidMappingLocation)) {
        this.context.stderr.write(renderMissingAndroidMappingFile(this.androidMappingLocation))

        return false
      }
    }

    if (!this.version && (await this.parsePubspec(this.pubspecLocation))) {
      return false
    }

    return true
  }
}

UploadCommand.addPath('flutter-symbols', 'upload')
UploadCommand.addOption('flavor', Command.String('--flavor'))
UploadCommand.addOption('dartSymbols', Command.Boolean('--dart-symbols'))
UploadCommand.addOption('dartSymbolsLocation', Command.String('--dart-symbols-location'))
UploadCommand.addOption('iosDsyms', Command.Boolean('--ios-dsyms'))
UploadCommand.addOption('iosDsymsLocation', Command.String('--ios-dsyms-location'))
UploadCommand.addOption('androidMapping', Command.Boolean('--android-mapping'))
UploadCommand.addOption('androidMappingLocation', Command.String('--android-mapping-location'))
UploadCommand.addOption('pubspecLocation', Command.String('--pubspec'))
UploadCommand.addOption('serviceName', Command.String('--service-name'))
UploadCommand.addOption('version', Command.String('--version'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
