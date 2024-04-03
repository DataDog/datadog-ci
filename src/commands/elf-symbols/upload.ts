import child_process from 'child_process'
import fs from 'fs'
import path from 'path'

import {Command, Option} from 'clipanion'
import glob from 'glob'

import {newApiKeyValidator} from '../../helpers/apikey'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {RepositoryData, getRepositoryData, newSimpleGit} from '../../helpers/git/format-git-sourcemaps-data'
import {MetricsLogger, getMetricsLogger} from '../../helpers/metrics'
import {MultipartValue, UploadStatus} from '../../helpers/upload'
import {buildPath, DEFAULT_CONFIG_PATHS, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import {getElfRequestBuilder, uploadMultipartHelper} from './helpers'
import {ELF_DEBUG_INFOS_FILENAME, MappingMetadata, TYPE_ELF_DEBUG_INFOS, VALUE_NAME_ELF_DEBUG_INFOS} from './interfaces'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidSymbolsDir,
  renderMissingElfSymbolsDir,
  renderMissingElfUtils,
  renderRetriedUpload,
  renderUpload,
} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['elf-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload Elf debug info files to Datadog.',
    details: `
            This command will upload debug info from all Elf files found recursively in the given location in order to symbolize profiles
        `,
    examples: [['Upload debug infos for all Elf files in the current directory', 'datadog-ci elf-symbols upload']],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private elfSymbolsLocation = Option.String('--elf-symbols-location', './')

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

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.elfSymbolsLocation))

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

  private getMappingMetadata(buildId: string, arch: string): MappingMetadata {
    return {
      arch,
      build_id: buildId,
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

  private isElfFile(filename: string): boolean {
    // read first 4 bytes of binary file and check if it is ELF
    const fd = fs.openSync(filename, 'r')
    const buffer = Buffer.alloc(4)
    fs.readSync(fd, buffer, 0, 4, 0)
    fs.closeSync(fd)

    // ELF files starts with 0x7F followed by ELF(0x45 0x4c 0x46) in ASCII
    return buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46
  }

  private getElfSymbolFiles(elfSymbolsLocation: string): string[] {
    const symbolPaths: string[] = []
    for (const file of glob.sync(buildPath(elfSymbolsLocation, '**'), {nodir: true})) {
      if (this.isElfFile(file)) {
        symbolPaths.push(file)
      }
    }

    return symbolPaths
  }

  private async performElfSymbolsUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    const files = this.getElfSymbolFiles(this.elfSymbolsLocation)

    const requestBuilder = getElfRequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)

    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, files, async (filename) => {
        // if (!fileMetadata.arch || !fileMetadata.platform) {
        //   renderFailedUpload(
        //     fileMetadata.filename,
        //     'Skipped because we could not determine the architecture or platform.'
        //   )

        //   return UploadStatus.Skipped
        // }

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload('Elf Symbol File', filename)}`)

          return UploadStatus.Success
        }

        const metadata = this.getMappingMetadata('build_id', 'arch')
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
                path: filename,
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
            this.context.stdout.write(renderFailedUpload(filename, e.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (e, attempts) => {
            this.context.stdout.write(renderRetriedUpload(filename, e.message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => {
            this.context.stdout.write(renderUpload('Flutter Symbol File', filename))
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

  private checkElfUtils(): boolean {
    try {
      child_process.execSync('readelf --version', {stdio: 'ignore'})
      child_process.execSync('objcopy --version', {stdio: 'ignore'})

      return true
    } catch (e) {
      return false
    }
  }

  private async verifyParameters(): Promise<boolean> {
    let parametersOkay = true

    if (!this.elfSymbolsLocation) {
      this.context.stderr.write(renderArgumentMissingError('elf-symbols-location'))
      parametersOkay = false
    } else {
      if (fs.existsSync(this.elfSymbolsLocation)) {
        const stats = fs.statSync(this.elfSymbolsLocation)
        if (!stats.isDirectory()) {
          this.context.stderr.write(renderInvalidSymbolsDir(this.elfSymbolsLocation))
          parametersOkay = false
        }
      } else {
        this.context.stderr.write(renderMissingElfSymbolsDir(this.elfSymbolsLocation))
        parametersOkay = false
      }
    }

    if (!this.checkElfUtils()) {
      this.context.stderr.write(renderMissingElfUtils())
      parametersOkay = false
    }

    return parametersOkay
  }
}
