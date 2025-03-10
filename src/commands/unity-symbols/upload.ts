import fs from 'fs'
import path, {basename} from 'path'

import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {globSync} from '../../helpers/fs'
import {RepositoryData, getRepositoryData, newSimpleGit} from '../../helpers/git/format-git-sourcemaps-data'
import {MetricsLogger, getMetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {
  DEFAULT_CONFIG_PATHS,
  buildPath,
  performSubCommand,
  resolveConfigFromFileAndEnvironment,
} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import * as dsyms from '../dsyms/upload'
import {createUniqueTmpDirectory} from '../dsyms/utils'
import * as elf from '../elf-symbols/elf'

import {getUnityRequestBuilder, uploadMultipartHelper} from './helpers'
import {
  IL2CPP_MAPPING_FILE_NAME,
  MappingMetadata,
  TYPE_IL2CPP_MAPPING,
  TYPE_NDK_SYMBOL_FILE,
  VALUE_NAME_IL2CPP_MAPPING,
  VALUE_NAME_NDK_SYMBOL_FILE,
} from './interfaces'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderMissingBuildId,
  renderMissingDir,
  renderMissingIL2CPPMappingFile as renderMissingIl2CppMappingFile,
  renderMustSupplyPlatform,
  renderRetriedUpload,
  renderUpload,
  renderUseOnlyOnePlatform,
} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['unity-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload Unity symbol files to Datadog.',
    details: `
            This command will upload all iOS symbol files for Unity applications in order to symbolicate errors and
            crash reports received by Datadog. This includes uploading dSYMs and IL2CPP mapping files.
        `,
    examples: [['Upload all symbol files from the default location', 'datadog-ci unity-symbols upload']],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private symbolsLocation = Option.String('--symbols-location', undefined)
  private android = Option.Boolean('--android', false)
  private ios = Option.Boolean('--ios', false)
  private skipIl2Cpp = Option.Boolean('--skip-il2cpp', false)

  private buildId?: string
  private cliVersion = version
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private gitData?: RepositoryData

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    if (!(await this.verifyParameters())) {
      return 1
    }

    const initialTime = Date.now()

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.buildId!, this.symbolsLocation!))

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

    const callResults: UploadStatus[] = []
    try {
      if (this.ios) {
        callResults.push(await this.performDsymUpload())
      } else if (this.android) {
        callResults.push(...(await this.performSoUpload()))
      }

      if (!this.skipIl2Cpp) {
        callResults.push(await this.performIl2CppMappingUpload())
      }

      const totalTime = (Date.now() - initialTime) / 1000

      this.context.stdout.write(renderCommandSummary(callResults, totalTime, this.dryRun))
    } catch (e) {
      this.context.stderr.write(renderGeneralizedError(e))

      return 1
    }

    return 0
  }

  private getApiKeyValidator(metricsLogger: MetricsLogger) {
    return newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
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
      type: 'string',
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

  private getMappingMetadata(type: string, arch?: string): MappingMetadata {
    return {
      arch,
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      build_id: this.buildId!,
      type,
    }
  }

  private getMetricsLogger(tags: string[]) {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:unity', ...tags],
      prefix: 'datadog.ci.symbols.upload.',
    })

    return metricsLogger
  }

  private async performDsymUpload() {
    const dsymUploadCommand = ['dsyms', 'upload', this.symbolsLocation!]
    dsymUploadCommand.push('--max-concurrency')
    dsymUploadCommand.push(`${this.maxConcurrency}`)
    if (this.dryRun) {
      dsymUploadCommand.push('--dry-run')
    }

    const exitCode = await performSubCommand(dsyms.UploadCommand, dsymUploadCommand, this.context)
    if (exitCode && exitCode !== 0) {
      return UploadStatus.Failure
    }

    return UploadStatus.Success
  }

  private async getBuildId(): Promise<number> {
    const buildIdPath = path.join(this.symbolsLocation!, 'build_id')
    if (!fs.existsSync(buildIdPath)) {
      this.context.stderr.write(renderMissingBuildId(buildIdPath))

      return 1
    }

    this.buildId = fs.readFileSync(buildIdPath)?.toString()
    if (!this.buildId) {
      this.context.stderr.write(renderMissingBuildId(buildIdPath))

      return 1
    }

    return 0
  }

  private async performSoUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger(['platform:unity'])
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    const soFiles = globSync(buildPath(this.symbolsLocation!, '**/*.so'))
    this.context.stdout.write(`${soFiles}`)

    const tmpDirectory = await createUniqueTmpDirectory()

    const requestBuilder = getUnityRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, soFiles, async (soFileName) => {
        const elfMetadata = await elf.getElfFileMetadata(soFileName)

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload(`Symbol File (${elfMetadata.arch})`, soFileName)}`)

          return UploadStatus.Success
        }

        const tempDir = buildPath(tmpDirectory, elfMetadata.arch)
        const tempFilePath = buildPath(tempDir, basename(soFileName))
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir)
        }
        await elf.copyElfDebugInfo(soFileName, tempFilePath, elfMetadata, true)

        const metadata = this.getMappingMetadata(TYPE_NDK_SYMBOL_FILE, elfMetadata.arch)
        const baseFilename = path.basename(soFileName)

        this.context.stdout.write(`[] ${tempFilePath}\n`)

        const payload = {
          content: new Map<string, MultipartValue>([
            [
              'event',
              {
                type: 'string',
                value: JSON.stringify(metadata),
                options: {filename: 'event', contentType: 'application/json'},
              },
            ],
            [VALUE_NAME_NDK_SYMBOL_FILE, {type: 'file', path: tempFilePath, options: {filename: baseFilename}}],
          ]),
        }
        if (this.gitData !== undefined) {
          payload.content.set('repository', this.getGitDataPayload(this.gitData))
        }

        return uploadMultipartHelper(requestBuilder, payload, {
          apiKeyValidator,
          onError: (e) => {
            this.context.stdout.write(renderFailedUpload(soFileName, e.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (e, attempts) => {
            this.context.stdout.write(renderRetriedUpload(soFileName, e.message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => {
            this.context.stdout.write(renderUpload(`Symbol File (${elfMetadata.arch})`, soFileName))
          },
          retries: 5,
          useGzip: true,
        })
      })

      return results
    } catch (error) {
      this.context.stdout.write(`ERROR: ${error}`)
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }

    return []
  }

  private async performIl2CppMappingUpload(): Promise<UploadStatus> {
    const il2cppMappingPath = path.join(this.symbolsLocation!, 'LineNumberMappings.json')

    if (!fs.existsSync(il2cppMappingPath)) {
      this.context.stderr.write(renderMissingIl2CppMappingFile(il2cppMappingPath))

      return 1
    }

    const metricsLogger = this.getMetricsLogger(['platform:unity'])
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    const requestBuilder = getUnityRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    if (this.dryRun) {
      this.context.stdout.write(`[DRYRUN] ${renderUpload('IL2CPP Mapping File', il2cppMappingPath)}`)

      return UploadStatus.Skipped
    }

    const metadata = this.getMappingMetadata(TYPE_IL2CPP_MAPPING)

    const payload = {
      content: new Map<string, MultipartValue>([
        [
          'event',
          {
            type: 'string',
            value: JSON.stringify(metadata),
            options: {filename: 'event', contentType: 'application/json'},
          },
        ],
        [
          VALUE_NAME_IL2CPP_MAPPING,
          {type: 'file', path: il2cppMappingPath, options: {filename: IL2CPP_MAPPING_FILE_NAME}},
        ],
      ]),
    }
    if (this.gitData !== undefined) {
      payload.content.set('repository', this.getGitDataPayload(this.gitData))
    }

    const status = await uploadMultipartHelper(requestBuilder, payload, {
      apiKeyValidator,
      onError: (e) => {
        this.context.stdout.write(renderFailedUpload(il2cppMappingPath, e.message))
        metricsLogger.logger.increment('failed', 1)
      },
      onRetry: (e, attempts) => {
        this.context.stdout.write(renderRetriedUpload(il2cppMappingPath, e.message, attempts))
        metricsLogger.logger.increment('retries', 1)
      },
      onUpload: () => {
        this.context.stdout.write(renderUpload('IL2CPP Mapping File', il2cppMappingPath))
      },
      retries: 5,
      useGzip: true,
    })

    if (status === UploadStatus.Success) {
      this.context.stdout.write('IL2CPP Mapping upload finished\n')
    } else {
      this.context.stdout.write(`IL2CPP Mapping upload failed\n`)
    }

    return status
  }

  private async verifyParameters(): Promise<boolean> {
    let parametersOkay = true

    if (!this.ios && !this.android) {
      this.context.stderr.write(renderMustSupplyPlatform())

      return false
    }

    if (this.ios && this.android) {
      this.context.stderr.write(renderUseOnlyOnePlatform())

      return false
    }

    if (this.symbolsLocation === undefined) {
      if (this.ios) {
        this.symbolsLocation = './datadogSymbols'
      } else if (this.android) {
        this.symbolsLocation = './unityLibrary/symbols'
      }
    }

    if (!this.symbolsLocation) {
      this.context.stderr.write(renderArgumentMissingError('symbols-location'))
      parametersOkay = false
    } else if (!fs.existsSync(this.symbolsLocation)) {
      this.context.stderr.write(renderMissingDir(this.symbolsLocation))

      return false
    }

    if (await this.getBuildId()) {
      parametersOkay = false
    }

    return parametersOkay
  }
}
