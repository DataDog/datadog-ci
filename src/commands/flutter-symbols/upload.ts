// Disabling no-unused-variable / no-empty temporarily so certain private methods
// can remain in while this feature is in progress
// tslint:disable: no-unused-variable
// tslint:disable: no-empty
import fs from 'fs'

import {Command} from 'clipanion'
import yaml from 'js-yaml'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidPubspecError,
  renderInvalidSymbolsDir,
  renderMissingAndroidMappingFile,
  renderMissingDartSymbolsDir,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
  renderRetriedUpload,
  renderUpload,
  UploadInfo,
} from './renderer'

import glob from 'glob'
import asyncPool from 'tiny-async-pool'
import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {getRepositoryData, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {buildPath, DEFAULT_CONFIG_PATH, performSubCommand, resolveConfigFromFile} from '../../helpers/utils'
import * as dsyms from '../dsyms/upload'
import {newSimpleGit} from '../git-metadata/git'
import {getArchInfoFromFilename, getFlutterRequestBuilder, uploadMultipartHelper} from './helpers'
import {
  DART_SYMBOL_FILE_NAME,
  JVM_MAPPING_FILE_NAME,
  MappingMetadata,
  TYPE_DART_SYMBOLS,
  TYPE_JVM_MAPPING,
  VALUE_NAME_DART_MAPPING,
  VALUE_NAME_JVM_MAPPING,
} from './interfaces'

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
  private dartSymbolsLocation?: string
  private disableGit = false
  private dryRun = false
  private flavor = 'release'
  private gitData?: RepositoryData
  private iosDsyms = false
  private iosDsymsLocation?: string
  private maxConcurrency = 5
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

    const uploadInfo: UploadInfo[] = []
    if (this.iosDsymsLocation) {
      uploadInfo.push({
        fileType: 'dSYMs',
        location: this.iosDsymsLocation!,
        platform: 'ios',
      })
    }
    if (this.androidMappingLocation) {
      uploadInfo.push({
        fileType: 'Proguard Mapping File',
        location: this.androidMappingLocation!,
        platform: 'Android',
      })
    }
    if (this.dartSymbolsLocation) {
      uploadInfo.push({
        fileType: 'Dart Symbol Files',
        location: this.dartSymbolsLocation!,
        platform: 'Flutter',
      })
    }

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.version!, this.serviceName, this.flavor, uploadInfo))

    this.config = await resolveConfigFromFile(this.config, {
      configPath: this.configPath,
      defaultConfigPath: DEFAULT_CONFIG_PATH,
    })

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
    }

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

    const initialTime = Date.now()

    const callResults: UploadStatus[] = []
    try {
      if (this.iosDsymsLocation) {
        callResults.push(await this.performDsymUpload())
      }
      if (this.androidMappingLocation) {
        callResults.push(await this.performAndroidMappingUpload(metricsLogger, apiKeyValidator))
      }
      if (this.dartSymbolsLocation) {
        callResults.push(...(await this.performDartSymbolsUpload(metricsLogger, apiKeyValidator)))
      }

      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderCommandSummary(callResults, totalTime, this.dryRun))
    } catch (e) {
      this.context.stderr.write(renderGeneralizedError(e))

      return 1
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }

    return 0
  }

  private getAndroidMetadata(): MappingMetadata {
    return this.getMappingMetadata(TYPE_JVM_MAPPING)
  }

  private getFlutterMetadata(platform: string, arch: string) {
    return this.getMappingMetadata(TYPE_DART_SYMBOLS, platform, arch)
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

  private getMappingMetadata(type: string, platform?: string, arch?: string): MappingMetadata {
    return {
      arch,
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      platform,
      service: this.serviceName,
      type,
      variant: this.flavor,
      version: this.version!,
    }
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

  private async performAndroidMappingUpload(
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): Promise<UploadStatus> {
    const requestBuilder = getFlutterRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    if (this.dryRun) {
      this.context.stdout.write(`[DRYRUN] ${renderUpload('Android Mapping File', this.androidMappingLocation!)}`)

      return 0
    }

    const metadata = this.getAndroidMetadata()

    const payload = {
      content: new Map<string, MultipartValue>([
        ['event', {value: JSON.stringify(metadata), options: {filename: 'event', contentType: 'application/json'}}],
        [
          VALUE_NAME_JVM_MAPPING,
          {value: fs.createReadStream(this.androidMappingLocation!), options: {filename: JVM_MAPPING_FILE_NAME}},
        ],
      ]),
    }
    if (this.gitData !== undefined) {
      payload.content.set('repository', this.getGitDataPayload()!)
    }

    const result = await uploadMultipartHelper(requestBuilder, payload, {
      apiKeyValidator,
      onError: (e) => {
        this.context.stdout.write(renderFailedUpload(this.androidMappingLocation!, e.message))
        metricsLogger.logger.increment('failed', 1)
      },
      onRetry: (e, attempts) => {
        this.context.stdout.write(renderRetriedUpload(this.androidMappingLocation!, e.message, attempts))
        metricsLogger.logger.increment('retries', 1)
      },
      onUpload: () => {
        this.context.stdout.write(renderUpload('Android Mapping File', this.androidMappingLocation!))
      },
      retries: 5,
    })
    this.context.stdout.write(`Mapping upload finished: ${result}\n`)

    return result
  }

  private async performDartSymbolsUpload(
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): Promise<UploadStatus[]> {
    const files = this.getFlutterSymbolFiles(this.dartSymbolsLocation!)

    const filesMetadata = files.map((filename) => ({filename, ...getArchInfoFromFilename(filename)}))

    const requestBuilder = getFlutterRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    try {
      const results = await asyncPool(this.maxConcurrency, filesMetadata, async (fileMetadata) => {
        if (!fileMetadata.arch || !fileMetadata.platform) {
          renderFailedUpload(
            fileMetadata.filename,
            'Skipped because we could not determine the architecture or platform.'
          )

          return UploadStatus.Skipped
        }

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload('Dart Symbol File', fileMetadata.filename!)}`)

          return UploadStatus.Success
        }

        const metadata = this.getFlutterMetadata(fileMetadata.platform, fileMetadata.arch)
        const payload = {
          content: new Map<string, MultipartValue>([
            ['event', {value: JSON.stringify(metadata), options: {filename: 'event', contentType: 'application/json'}}],
            [
              VALUE_NAME_DART_MAPPING,
              {value: fs.createReadStream(fileMetadata.filename), options: {filename: DART_SYMBOL_FILE_NAME}},
            ],
          ]),
        }
        if (this.gitData !== undefined) {
          payload.content.set('repository', this.getGitDataPayload()!)
        }

        return uploadMultipartHelper(requestBuilder, payload, {
          apiKeyValidator,
          onError: (e) => {
            this.context.stdout.write(renderFailedUpload(fileMetadata.filename!, e.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (e, attempts) => {
            this.context.stdout.write(renderRetriedUpload(fileMetadata.filename, e.message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => {
            this.context.stdout.write(renderUpload('Flutter Symbol File', fileMetadata.filename))
          },
          retries: 5,
        })
      })

      return results
    } catch (error) {
      throw error
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private async performDsymUpload() {
    const dsymUploadCommand = ['dsyms', 'upload', this.iosDsymsLocation!]
    if (this.dryRun) {
      dsymUploadCommand.push('--dry-run')
    }

    const exitCode = await performSubCommand(dsyms.UploadCommand, dsymUploadCommand, this.context)
    if (exitCode && exitCode !== 0) {
      return UploadStatus.Failure
    }

    return UploadStatus.Success
  }

  private async verifyParameters(): Promise<boolean> {
    if (!this.serviceName) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))

      return false
    }

    if (this.dartSymbolsLocation) {
      if (!fs.existsSync(this.dartSymbolsLocation)) {
        this.context.stderr.write(renderMissingDartSymbolsDir(this.dartSymbolsLocation))

        return false
      }

      const stats = fs.statSync(this.dartSymbolsLocation)
      if (!stats.isDirectory()) {
        this.context.stderr.write(renderInvalidSymbolsDir(this.dartSymbolsLocation))

        return false
      }
    }

    if (this.iosDsyms && !this.iosDsymsLocation) {
      this.iosDsymsLocation = './build/ios/archive/Runner.xcarchive/dSYMs'
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
UploadCommand.addOption('dartSymbolsLocation', Command.String('--dart-symbols-location'))
UploadCommand.addOption('iosDsyms', Command.Boolean('--ios-dsyms'))
UploadCommand.addOption('iosDsymsLocation', Command.String('--ios-dsyms-location'))
UploadCommand.addOption('androidMapping', Command.Boolean('--android-mapping'))
UploadCommand.addOption('androidMappingLocation', Command.String('--android-mapping-location'))
UploadCommand.addOption('pubspecLocation', Command.String('--pubspec'))
UploadCommand.addOption('serviceName', Command.String('--service-name'))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('version', Command.String('--version'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
