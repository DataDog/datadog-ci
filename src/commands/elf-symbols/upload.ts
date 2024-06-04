import fs from 'fs'

import {Command, Option} from 'clipanion'
import glob from 'glob'

import {newApiKeyValidator} from '../../helpers/apikey'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {RepositoryData, getRepositoryData, newSimpleGit} from '../../helpers/git/format-git-sourcemaps-data'
import {MetricsLogger, getMetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {buildPath, DEFAULT_CONFIG_PATHS, execute, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import {createUniqueTmpDirectory, deleteDirectory} from '../dsyms/utils'

import {
  ElfFileMetadata,
  getElfFileMetadata,
  isSupportedElfType,
  getBuildId,
  getOutputFilenameFromBuildId,
  copyElfDebugInfo,
  isSupportedArch,
} from './elf'
import {getElfRequestBuilder, uploadMultipartHelper} from './helpers'
import {ELF_DEBUG_INFOS_FILENAME, MappingMetadata, TYPE_ELF_DEBUG_INFOS, VALUE_NAME_ELF_DEBUG_INFOS} from './interfaces'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidSymbolsLocation,
  renderMissingBinUtils,
  renderRetriedUpload,
  renderUpload,
  renderWarning,
} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['elf-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload Elf debug info files to Datadog.',
    details: `
            This command will upload debug info from all Elf files found recursively in the given location in order to symbolicate profiles
        `,
    examples: [['Upload debug infos for all Elf files in the current directory', 'datadog-ci elf-symbols upload']],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private symbolsLocation = Option.String('--symbols-location', './')

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

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.symbolsLocation))

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
      callResults.push(...(await this.performElfSymbolsUpload()))

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

  private getMappingMetadata(gnuBuildId: string, goBuildId: string, fileHash: string, arch: string): MappingMetadata {
    return {
      arch,
      gnu_build_id: gnuBuildId,
      go_build_id: goBuildId,
      file_hash: fileHash,
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      platform: 'elf',
      type: TYPE_ELF_DEBUG_INFOS,
    }
  }

  private getMetricsLogger() {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:elf'],
      prefix: 'datadog.ci.elf_symbols.',
    })

    return metricsLogger
  }

  private async getElfSymbolFiles(symbolsLocation: string): Promise<ElfFileMetadata[]> {
    let files: string[] = []
    let reportFailure

    if (fs.statSync(symbolsLocation).isDirectory()) {
      files = glob.sync(buildPath(symbolsLocation, '**'), {nodir: true, dot: true})
      reportFailure = (message: string) => this.context.stdout.write(renderWarning(message))
    } else {
      files = [symbolsLocation]
      // in single file mode, we want to report failures as errors
      reportFailure = (message: string) => {
        throw Error(message)
      }
    }

    const filesMetadata: ElfFileMetadata[] = []
    for (const file of files) {
      // check that path is a file and is an ELF file
      if (fs.lstatSync(file).isFile()) {
        const metadata = await getElfFileMetadata(file)

        // handle all possible failures
        if (!metadata.isElf) {
          reportFailure(`Input location ${file} is not an ELF file`)
          continue
        }
        if (metadata.error) {
          reportFailure(`Error reading ELF file ${file}: ${metadata.error.message}`)
          continue
        }
        if (!isSupportedElfType(metadata.type)) {
          reportFailure(`Skipped ${file} because its not an executable, nor a shared library`)
          continue
        }
        if (!isSupportedArch(metadata.arch)) {
          reportFailure(`Skipped ${file} because it has an unsupported architecture (${metadata.arch})`)
          continue
        }
        if (!(metadata.gnuBuildId || metadata.goBuildId || metadata.fileHash)) {
          reportFailure(`Skipped ${file} because it has no build id`)
          continue
        }
        if (!metadata.hasDebugInfo && !metadata.hasSymbols) {
          reportFailure(`Skipped ${file} because it has no debug info, nor symbols`)
          continue
        }
        filesMetadata.push(metadata)
      }
    }

    // sort files to make output deterministic
    filesMetadata.sort((a, b) => a.filename.localeCompare(b.filename))

    return filesMetadata
  }

  private removeBuildIdDuplicates(filesMetadata: ElfFileMetadata[]): ElfFileMetadata[] {
    const buildIds = new Map<string, ElfFileMetadata>()
    for (const metadata of filesMetadata) {
      const buildId = getBuildId(metadata)
      const existing = buildIds.get(buildId)
      if (existing) {
        if ((metadata.hasDebugInfo && !existing.hasDebugInfo) || (metadata.hasSymbols && !existing.hasSymbols)) {
          // if we have a duplicate build_id, we keep the one with debug info and symbols
          this.context.stderr.write(
            renderWarning(
              `Duplicate build_id found: ${buildId} in ${metadata.filename} and ${existing.filename} - skipping ${existing.filename} because it has no debug info or symbols`
            )
          )
          buildIds.set(buildId, metadata)
        } else {
          // if both files have debug info and symbols, we keep the first one
          this.context.stderr.write(
            renderWarning(
              `Duplicate build_id found: ${buildId} in ${metadata.filename} and ${existing.filename} - skipping ${metadata.filename}`
            )
          )
        }
      } else {
        buildIds.set(buildId, metadata)
      }
    }

    return Array.from(buildIds.values()).sort((a, b) => a.filename.localeCompare(b.filename))
  }

  private async performElfSymbolsUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    let elfFilesMetadata = await this.getElfSymbolFiles(this.symbolsLocation)
    elfFilesMetadata = this.removeBuildIdDuplicates(elfFilesMetadata)

    const requestBuilder = getElfRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)
    const tmpDirectory = await createUniqueTmpDirectory()

    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, elfFilesMetadata, async (fileMetadata) => {
        const metadata = this.getMappingMetadata(
          fileMetadata.gnuBuildId,
          fileMetadata.goBuildId,
          fileMetadata.fileHash,
          fileMetadata.arch
        )
        const outputFilename = getOutputFilenameFromBuildId(getBuildId(fileMetadata))
        const outputFilePath = buildPath(tmpDirectory, outputFilename)
        await copyElfDebugInfo(fileMetadata.filename, outputFilePath, fileMetadata, false)

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload(fileMetadata.filename, metadata)}`)

          return UploadStatus.Success
        }

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
              VALUE_NAME_ELF_DEBUG_INFOS,
              {
                type: 'file',
                path: outputFilePath,
                options: {filename: ELF_DEBUG_INFOS_FILENAME},
              },
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
            this.context.stdout.write(renderUpload(fileMetadata.filename, metadata))
          },
          retries: 5,
          useGzip: true,
        }).finally(() => {
          // ignore errors when removing the file
          fs.rm(outputFilePath, () => {})
        })
      })

      return results
    } catch (error) {
      throw error
    } finally {
      await deleteDirectory(tmpDirectory)
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private async checkBinUtils(): Promise<boolean> {
    try {
      await execute('objcopy --version')

      return true
    } catch (e) {
      return false
    }
  }

  private async verifyParameters(): Promise<boolean> {
    let parametersOkay = true

    if (!this.symbolsLocation) {
      this.context.stderr.write(renderArgumentMissingError('symbols-location'))
      parametersOkay = false
    } else {
      if (fs.existsSync(this.symbolsLocation)) {
        const stats = fs.statSync(this.symbolsLocation)
        if (!stats.isDirectory() && !stats.isFile()) {
          this.context.stderr.write(renderInvalidSymbolsLocation(this.symbolsLocation))
          parametersOkay = false
        }
      } else {
        this.context.stderr.write(renderInvalidSymbolsLocation(this.symbolsLocation))
        parametersOkay = false
      }
    }

    if (!(await this.checkBinUtils())) {
      this.context.stderr.write(renderMissingBinUtils())
      parametersOkay = false
    }

    return parametersOkay
  }
}
