import fs from 'fs'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {
  RepositoryData,
  getRepositoryData,
  newSimpleGit,
} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {MetricsLogger, getMetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import {MultipartValue, UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {
  buildPath,
  DEFAULT_CONFIG_PATHS,
  resolveConfigFromFileAndEnvironment,
} from '@datadog/datadog-ci-base/helpers/utils'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'
import {checkAPIKeyOverride} from '@datadog/datadog-ci-base/helpers/validation'
import {Command, Option} from 'clipanion'
import upath from 'upath'

import {cliVersion} from '../../version'

import {getPERequestBuilder, uploadMultipartHelper} from './helpers'
import {PE_DEBUG_INFOS_FILENAME, MappingMetadata, TYPE_PE_DEBUG_INFOS, VALUE_NAME_PE_DEBUG_INFOS} from './interfaces'
import {getBuildId, getPEFileMetadata, PEFileMetadata} from './pe'
import {MachineArchitecture} from './pe-constants'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidSymbolsLocation,
  renderMissingPdbFile,
  renderEventPayload,
  renderRetriedUpload,
  renderUpload,
  renderWarning,
} from './renderer'

export class UploadCommand extends Command {
  public static paths = [['pe-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'Profiling',
    description: 'Upload Windows PE debug info files to Datadog.',
    details: `
            This command will upload debug info from all PE files found recursively in the given location in order to symbolicate profiles
        `,
    examples: [['Upload debug infos for all PE files in the current directory', 'datadog-ci pe-symbols upload .']],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private replaceExisting = Option.Boolean('--replace-existing', false)
  private symbolsLocations = Option.Rest({required: 1})

  private cliVersion = cliVersion
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

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.symbolsLocations))

    this.config = await resolveConfigFromFileAndEnvironment(
      this.config,
      {
        apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
        datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
      },
      {
        configPath: this.configPath,
        defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        configFromFileCallback: (configFromFile: any) => {
          checkAPIKeyOverride(
            process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
            configFromFile.apiKey,
            this.context.stdout
          )
        },
      }
    )

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
    }

    const callResults: UploadStatus[] = []
    try {
      callResults.push(...(await this.performPESymbolsUpload()))

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

  private getPESymbolSource(peFileMetadata: PEFileMetadata): string {
    if (peFileMetadata.hasPdbInfo) {
      return 'debug_info'
    }

    return 'none'
  }

  private getArchitecture(architecture: MachineArchitecture): string {
    if (architecture === MachineArchitecture.x86) {
      return 'x86'
    } else if (architecture === MachineArchitecture.x64) {
      return 'x64'
    } else if (architecture === MachineArchitecture.Arm32) {
      return 'arm32'
    } else if (architecture === MachineArchitecture.Arm64) {
      return 'arm64'
    } else {
      return 'unknown'
    }
  }

  private getMappingMetadata(peFileMetadata: PEFileMetadata): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      origin_version: this.cliVersion,
      origin: 'datadog-ci',
      arch: this.getArchitecture(peFileMetadata.arch),
      pdb_age: peFileMetadata.pdbAge,
      pdb_sig: peFileMetadata?.pdbSig,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      symbol_source: this.getPESymbolSource(peFileMetadata),
      filename: upath.basename(peFileMetadata.pdbFilename),
      overwrite: this.replaceExisting,
      type: TYPE_PE_DEBUG_INFOS,
    }
  }

  private getMetricsLogger() {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:pe'],
      prefix: 'datadog.ci.pe_symbols.',
    })

    return metricsLogger
  }

  private async getPESymbolFiles(symbolsLocation: string): Promise<PEFileMetadata[]> {
    let paths: string[] = []
    let reportFailure: (message: string) => void

    const stat = await fs.promises.stat(symbolsLocation)
    if (stat.isDirectory()) {
      // strict: false is needed to avoid throwing an error if a directory is not readable
      paths = globSync(buildPath(symbolsLocation, '**'), {dot: true, dotRelative: true})
      reportFailure = (message: string) => this.context.stdout.write(renderWarning(message))

      // throw an error if top-level directory is not readable
      // eslint-disable-next-line no-bitwise
      await fs.promises.access(symbolsLocation, fs.constants.R_OK | fs.constants.X_OK).catch(() => {
        throw Error(`Directory ${symbolsLocation} is not readable`)
      })
    } else {
      paths = [symbolsLocation]
      // in single file mode, we want to report failures as errors
      reportFailure = (message: string) => {
        throw Error(message)
      }
    }

    const filesMetadata: PEFileMetadata[] = []
    for (const p of paths) {
      const pathStat = await fs.promises.lstat(p)
      if (pathStat.isDirectory()) {
        // check if directory is readable and if not emit a warning
        // eslint-disable-next-line no-bitwise
        await fs.promises.access(p, fs.constants.R_OK | fs.constants.X_OK).catch(() => {
          reportFailure(`Skipped directory ${p} because it is not readable`)
        })
      } else if (pathStat.isFile()) {
        // check that path is a file and is a PE file
        const metadata = await getPEFileMetadata(p)

        // handle all possible failures
        if (!metadata.isPE) {
          reportFailure(`Input location ${p} is not a PE file`)
          continue
        }
        if (metadata.error) {
          reportFailure(`Error reading PE file ${p}: ${metadata.error.message}`)
          continue
        }
        if (!metadata.hasPdbInfo) {
          reportFailure(`Skipped ${p} because it has no debug info, nor symbols`)
          continue
        }
        filesMetadata.push(metadata)
      }
    }

    // sort files to make output deterministic
    filesMetadata.sort((a, b) => a.filename.localeCompare(b.filename))

    return filesMetadata
  }

  private removeBuildIdDuplicates(filesMetadata: PEFileMetadata[]): PEFileMetadata[] {
    const buildIds = new Map<string, PEFileMetadata>()
    for (const metadata of filesMetadata) {
      const buildId = getBuildId(metadata)
      const existing = buildIds.get(buildId)
      if (existing) {
        // if both files have debug info and symbols, we keep the first one
        this.context.stderr.write(
          renderWarning(
            `Duplicate build_id found: ${buildId} in ${metadata.filename} and ${existing.filename} - skipping ${metadata.filename}`
          )
        )
      } else {
        buildIds.set(buildId, metadata)
      }
    }

    return Array.from(buildIds.values()).sort((a, b) => a.filename.localeCompare(b.filename))
  }

  private getFileInSameFolder(pathname: string, newFilename: string): string {
    const dirname = upath.dirname(pathname)
    const newPathname = upath.join(dirname, upath.basename(newFilename))

    return newPathname
  }

  private getAssociatedPdbFilename(pathname: string): string {
    const basename = upath.basename(pathname, upath.extname(pathname))
    const dirname = upath.dirname(pathname)
    const newPathname = upath.join(dirname, `${basename}.pdb`)

    return newPathname
  }

  private async performPESymbolsUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    let peFilesMetadata = (
      await Promise.all(this.symbolsLocations.map((location) => this.getPESymbolFiles(location)))
    ).flat()
    peFilesMetadata = this.removeBuildIdDuplicates(peFilesMetadata)

    const requestBuilder = getPERequestBuilder(this.config.apiKey!, this.cliVersion, this.config.datadogSite)

    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, peFilesMetadata, async (fileMetadata) => {
        const metadata = this.getMappingMetadata(fileMetadata)

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload(fileMetadata.filename, metadata)}`)

          // TODO: uncomment the following when dryRun won't be TRUE by default
          // return UploadStatus.Success
        }

        // get the .pdb filename based on the .dll filename and copy it into a temp folder
        // --> not sure the ELF-based code makes any sense for PE files...
        //     instead, we should not need to copy anything:
        //     1. get the .pdb filename from the .dll file (ex: foo64.dll --> foo.pdb)
        //     2. look for it in the same folder as the .dll file
        //     3. if it is not there, look in the same folder for a file with the same name as .dll but with a .pdb extension
        //     4. if it is there, upload it; if not generate a skip warning
        //
        let pdbFilename = this.getFileInSameFolder(fileMetadata.filename, fileMetadata.pdbFilename)
        // TODO: remove this log after debugging
        this.context.stdout.write(`[LOG] Look for pdb file = ${pdbFilename}\n`)

        if (!fs.existsSync(pdbFilename)) {
          pdbFilename = this.getAssociatedPdbFilename(fileMetadata.filename)

          if (!fs.existsSync(pdbFilename)) {
            this.context.stdout.write(renderMissingPdbFile(fileMetadata.pdbFilename, fileMetadata.filename))

            return UploadStatus.Skipped
          }
        }

        // TODO: remove this log after debugging
        this.context.stdout.write(`[LOG]      Use pdb file = ${pdbFilename}\n`)

        const eventValue = JSON.stringify(metadata)
        this.context.stdout.write(renderEventPayload(eventValue))

        const payload = {
          content: new Map<string, MultipartValue>([
            [
              'event',
              {
                type: 'string',
                value: eventValue,
                options: {filename: 'event', contentType: 'application/json'},
              },
            ],
            [
              VALUE_NAME_PE_DEBUG_INFOS,
              {
                type: 'file',
                path: pdbFilename,
                options: {filename: PE_DEBUG_INFOS_FILENAME},
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

  private async verifyParameters(): Promise<boolean> {
    let parametersOkay = true

    if (!this.symbolsLocations || this.symbolsLocations.length === 0) {
      this.context.stderr.write(renderArgumentMissingError('symbols locations'))
      parametersOkay = false
    } else {
      for (const symbolsLocation of this.symbolsLocations) {
        if (fs.existsSync(symbolsLocation)) {
          const stats = fs.statSync(symbolsLocation)
          if (!stats.isDirectory() && !stats.isFile()) {
            this.context.stderr.write(renderInvalidSymbolsLocation(symbolsLocation))
            parametersOkay = false
          }
        } else {
          this.context.stderr.write(renderInvalidSymbolsLocation(symbolsLocation))
          parametersOkay = false
        }
      }
    }

    return parametersOkay
  }
}
