import fs from 'fs'

import {Command, Option} from 'clipanion'
import glob from 'glob'
import yaml from 'js-yaml'
import semver from 'semver'
import asyncPool from 'tiny-async-pool'

import {newApiKeyValidator} from '../../helpers/apikey'
import {getRepositoryData, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {
  buildPath,
  DEFAULT_CONFIG_PATHS,
  performSubCommand,
  resolveConfigFromFileAndEnvironment,
} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import * as dsyms from '../dsyms/upload'
import {newSimpleGit} from '../git-metadata/git'
import * as sourcemaps from '../sourcemaps/upload'

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
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidPubspecError,
  renderInvalidSymbolsDir,
  renderMinifiedPathPrefixRequired,
  renderMissingAndroidMappingFile,
  renderMissingDartSymbolsDir,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
  renderRetriedUpload,
  renderUpload,
  renderVersionBuildNumberWarning,
  renderVersionNotSemver,
  UploadInfo,
} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['flutter-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload Flutter symbol files to Datadog.',
    details: `
            This command will upload all symbol files for Flutter applications in order to symbolicate errors and
            crash reports received by Datadog. This includes uploading iOS dSYMs, Proguard mapping files, and Dart
            symbol files.
        `,
    examples: [
      [
        'Upload all symbol files from default locations',
        'datadog-ci flutter-symbols upload --dart-symbols-location ./debug-info --service-name com.datadog.example --ios-dsyms --android-mapping',
      ],
    ],
  })

  private androidMapping = Option.Boolean('--android-mapping', false)
  private androidMappingLocation = Option.String('--android-mapping-location')
  private webSourceMaps = Option.Boolean('--web-sourcemaps', false)
  private webSourceMapsLocation = Option.String('--web-sourcemaps-location')
  private minifiedPathPrefix = Option.String('--minified-path-prefix')
  private configPath = Option.String('--config')
  private dartSymbolsLocation = Option.String('--dart-symbols-location')
  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private flavor = Option.String('--flavor', 'release')
  private iosDsyms = Option.Boolean('--ios-dsyms', false)
  private iosDsymsLocation = Option.String('--ios-dsyms-location')
  private maxConcurrency = Option.String('--max-concurrency', '5', {validator: validation.isInteger()})
  private pubspecLocation = Option.String('--pubspec', './pubspec.yaml')
  private repositoryUrl = Option.String('--repository-url')
  private serviceName = Option.String('--service-name')
  private version = Option.String('--version')

  private cliVersion = version
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private gitData?: RepositoryData

  public async execute() {
    if (!(await this.verifyParameters())) {
      return 1
    }

    const uploadInfo: UploadInfo[] = []
    if (this.iosDsymsLocation) {
      uploadInfo.push({
        fileType: 'dSYMs',
        location: this.iosDsymsLocation,
        platform: 'ios',
      })
    }
    if (this.androidMappingLocation) {
      uploadInfo.push({
        fileType: 'Proguard Mapping File',
        location: this.androidMappingLocation,
        platform: 'Android',
      })
    }
    if (this.dartSymbolsLocation) {
      uploadInfo.push({
        fileType: 'Dart Symbol Files',
        location: this.dartSymbolsLocation,
        platform: 'Flutter',
      })
    }
    if (this.webSourceMapsLocation) {
      uploadInfo.push({
        fileType: 'JavaScript Source Maps',
        location: this.webSourceMapsLocation,
        platform: 'Browser',
      })
    }

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.version!, this.serviceName!, this.flavor, uploadInfo))

    this.config = await resolveConfigFromFileAndEnvironment(
      this.config,
      {
        apiKey: process.env.DATADOG_API_KEY,
        datadogSite: process.env.DATADOG_SITE,
      },
      {
        configPath: this.configPath,
        defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        configFromFileCallback: (configFromFile: any) => {
          checkAPIKeyOverride(process.env.DATADOG_API_KEY, configFromFile.apiKey, this.context.stdout)
        },
      }
    )

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
    }

    const initialTime = Date.now()

    const callResults: UploadStatus[] = []
    try {
      if (this.iosDsymsLocation) {
        callResults.push(await this.performDsymUpload())
      }
      if (this.androidMappingLocation) {
        callResults.push(await this.performAndroidMappingUpload())
      }
      if (this.dartSymbolsLocation) {
        callResults.push(...(await this.performDartSymbolsUpload()))
      }
      if (this.webSourceMapsLocation) {
        callResults.push(await this.performSourceMapUpload())
      }

      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderCommandSummary(callResults, totalTime, this.dryRun))
    } catch (e) {
      this.context.stderr.write(renderGeneralizedError(e))

      return 1
    }

    return 0
  }

  private getAndroidMetadata(): MappingMetadata {
    return this.getMappingMetadata(TYPE_JVM_MAPPING)
  }

  private getApiKeyValidator(metricsLogger: MetricsLogger) {
    return newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
  }

  private getFlutterMetadata(platform: string, arch: string) {
    return this.getMappingMetadata(TYPE_DART_SYMBOLS, platform, arch)
  }

  private getFlutterSymbolFiles(dartSymbolLocation: string): string[] {
    const symbolPaths = glob.sync(buildPath(dartSymbolLocation, '*.symbols'))

    return symbolPaths
  }

  private getGitDataPayload(gitData: RepositoryData): MultipartValue {
    const files = gitData.trackedFilesMatcher.rawTrackedFilesList()
    const repoPayload = {
      data: [
        {
          files,
          hash: gitData.hash,
          repository_url: gitData.remote,
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
      service: this.serviceName!,
      type,
      variant: this.flavor,
      version: this.getSanitizedVersion(),
    }
  }

  private getMetricsLogger(tags: string[]) {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [
        `version:${this.version}`,
        `service:${this.serviceName}`,
        `cli_version:${this.cliVersion}`,
        'platform:flutter',
        ...tags,
      ],
      prefix: 'datadog.ci.symbols.upload.',
    })

    return metricsLogger
  }

  private getSanitizedVersion() {
    return this.version!.replace('+', '-')
  }

  private async parsePubspecVersion(pubspecLocation: string): Promise<number> {
    if (!fs.existsSync(pubspecLocation)) {
      this.context.stderr.write(renderMissingPubspecError(pubspecLocation))

      return 1
    }

    try {
      const doc = yaml.load(fs.readFileSync(pubspecLocation, 'utf8')) as any
      if (doc.version) {
        this.version = doc.version
        const parsedVersion = semver.parse(this.version)
        if (parsedVersion) {
          if (parsedVersion.build.length > 0 || parsedVersion.prerelease.length > 0) {
            this.context.stderr.write(renderVersionBuildNumberWarning(pubspecLocation))

            this.version = `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch}`
          }
        } else {
          this.context.stderr.write(renderVersionNotSemver(pubspecLocation, this.version))
        }
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

  private async performAndroidMappingUpload(): Promise<UploadStatus> {
    const metricsLogger = this.getMetricsLogger(['platform:android'])
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

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
      payload.content.set('repository', this.getGitDataPayload(this.gitData))
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
      useGzip: true,
    })
    this.context.stdout.write(`Mapping upload finished: ${result}\n`)

    return result
  }

  private async performDartSymbolsUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger(['platform:android'])
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

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
          this.context.stdout.write(`[DRYRUN] ${renderUpload('Dart Symbol File', fileMetadata.filename)}`)

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
          payload.content.set('repository', this.getGitDataPayload(this.gitData))
        }

        return uploadMultipartHelper(requestBuilder, payload, {
          apiKeyValidator,
          onError: (e) => {
            this.context.stdout.write(renderFailedUpload(fileMetadata.filename, e.message))
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
          useGzip: true,
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

  private async performSourceMapUpload() {
    const sourceMapUploadCommand = [
      'sourcemaps',
      'upload',
      this.webSourceMapsLocation!,
      `--service=${this.serviceName}`,
      `--release-version=${this.version}`,
      `--minified-path-prefix=${this.minifiedPathPrefix}`,
    ]
    if (this.dryRun) {
      sourceMapUploadCommand.push('--dry-run')
    }

    const exitCode = await performSubCommand(sourcemaps.UploadCommand, sourceMapUploadCommand, this.context)
    if (exitCode && exitCode !== 0) {
      return UploadStatus.Failure
    }

    return UploadStatus.Success
  }

  private async verifyParameters(): Promise<boolean> {
    let parametersOkay = true

    if (!this.serviceName) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))
      parametersOkay = false
    }

    if (this.dartSymbolsLocation) {
      if (fs.existsSync(this.dartSymbolsLocation)) {
        const stats = fs.statSync(this.dartSymbolsLocation)
        if (!stats.isDirectory()) {
          this.context.stderr.write(renderInvalidSymbolsDir(this.dartSymbolsLocation))
          parametersOkay = false
        }
      } else {
        this.context.stderr.write(renderMissingDartSymbolsDir(this.dartSymbolsLocation))
        parametersOkay = false
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
        parametersOkay = false
      }
    }

    if (this.webSourceMaps && !this.webSourceMapsLocation) {
      this.webSourceMapsLocation = './build/web'
    }

    if (this.webSourceMapsLocation) {
      if (!this.minifiedPathPrefix) {
        this.context.stderr.write(renderMinifiedPathPrefixRequired())
        parametersOkay = false
      }
    }

    if (!this.version && (await this.parsePubspecVersion(this.pubspecLocation))) {
      parametersOkay = false
    }

    return parametersOkay
  }
}
