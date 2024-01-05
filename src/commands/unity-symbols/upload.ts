import fs from 'fs'
import path from 'path'

import {Command, Option} from 'clipanion'

import {newApiKeyValidator} from '../../helpers/apikey'
import {RepositoryData, getRepositoryData, newSimpleGit} from '../../helpers/git/format-git-sourcemaps-data'
import {MetricsLogger, getMetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {DEFAULT_CONFIG_PATHS, performSubCommand, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import * as dsyms from '../dsyms/upload'

import {getUnityRequestBuilder, uploadMultipartHelper} from './helpers'
import {IL2CPP_MAPPING_FILE_NAME, MappingMetadata, TYPE_IL2CPP_MAPPING, VALUE_NAME_IL2CPP_MAPPING} from './interfaces'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderMissingBuildId,
  renderMissingIL2CPPMappingFile as renderMissingIl2CppMappingFile,
  renderRetriedUpload,
  renderUpload,
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
  private symbolsLocation = Option.String('--symbols-location', './datadogSymbols')

  private buildId?: string
  private cliVersion = version
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private gitData?: RepositoryData

  public async execute() {
    if (!(await this.verifyParameters())) {
      return 1
    }

    const initialTime = Date.now()

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.buildId!, this.symbolsLocation))

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
      callResults.push(await this.performDsymUpload())
      callResults.push(await this.performIl2CppMappingUpload())

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

  private getMappingMetadata(): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      build_id: this.buildId!,
      type: TYPE_IL2CPP_MAPPING,
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
    const dsymUploadCommand = ['dsyms', 'upload', this.symbolsLocation]
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
    const buildIdPath = path.join(this.symbolsLocation, 'build_id')
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

  private async performIl2CppMappingUpload(): Promise<UploadStatus> {
    const il2cppMappingPath = path.join(this.symbolsLocation, 'LineNumberMappings.json')
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

    const metadata = this.getMappingMetadata()

    const payload = {
      content: new Map<string, MultipartValue>([
        ['event', {value: JSON.stringify(metadata), options: {filename: 'event', contentType: 'application/json'}}],
        [
          VALUE_NAME_IL2CPP_MAPPING,
          {value: fs.createReadStream(il2cppMappingPath), options: {filename: IL2CPP_MAPPING_FILE_NAME}},
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

    if (!this.symbolsLocation) {
      this.context.stderr.write(renderArgumentMissingError('symbols-location'))
      parametersOkay = false
    }

    if (await this.getBuildId()) {
      parametersOkay = false
    }

    return parametersOkay
  }
}
