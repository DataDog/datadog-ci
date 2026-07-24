import fs from 'fs'

import type {MappingMetadata} from './interfaces'
import type {WasmFileMetadata} from './wasm'
import type {RepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import type {MetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import type {MultipartValue} from '@datadog/datadog-ci-base/helpers/upload'

import {Command, Option} from 'clipanion'
import upath from 'upath'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSiteFromEnv} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getRepositoryData, newSimpleGit} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {globAsync} from '@datadog/datadog-ci-base/helpers/glob'
import {getMetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {
  buildPath,
  DEFAULT_CONFIG_PATHS,
  resolveConfigFromFileAndEnvironment,
} from '@datadog/datadog-ci-base/helpers/utils'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'
import {checkAPIKeyOverride} from '@datadog/datadog-ci-base/helpers/validation'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {getWasmRequestBuilder, uploadMultipartHelper} from './helpers'
import {TYPE_WASM_DEBUG_INFOS, VALUE_NAME_WASM_DEBUG_INFOS, WASM_DEBUG_INFOS_FILENAME} from './interfaces'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidSymbolsLocation,
  renderRetriedUpload,
  renderUpload,
  renderWarning,
} from './renderer'
import {getBuildIdWithArch, getWasmFileMetadata} from './wasm'
import {DEFAULT_WASM_ARCH, isSupportedWasmArch} from './wasm-constants'

export class WasmSymbolsUploadCommand extends BaseCommand {
  public static paths = [['wasm-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'Profiling',
    description: 'Upload WASM debug info files to Datadog.',
    details: `
            This command will upload debug info from all WebAssembly (.wasm) files found recursively in the given
            location in order to symbolicate WASM stack traces reported by the Datadog Browser SDK.
        `,
    examples: [['Upload debug infos for all WASM files in the current directory', 'datadog-ci wasm-symbols upload .']],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private replaceExisting = Option.Boolean('--replace-existing', false)
  private arch = Option.String('--arch', DEFAULT_WASM_ARCH)
  private sourceUrl = Option.String('--source-url')
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
        datadogSite: getDatadogSiteFromEnv(),
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
      callResults.push(...(await this.performWasmSymbolsUpload()))

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

  private getWasmSymbolSource(wasmFileMetadata: WasmFileMetadata): string {
    if (wasmFileMetadata.hasDebugInfo) {
      return 'debug_info'
    }
    if (wasmFileMetadata.hasExternalDebugInfo) {
      return 'external_debug_info'
    }

    return 'none'
  }

  private getMappingMetadata(wasmFileMetadata: WasmFileMetadata): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      origin_version: this.cliVersion,
      origin: 'datadog-ci',
      arch: this.arch,
      build_id: wasmFileMetadata.buildId,
      file_hash: wasmFileMetadata.fileHash,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      symbol_source: this.getWasmSymbolSource(wasmFileMetadata),
      filename: upath.basename(wasmFileMetadata.filename),
      overwrite: this.replaceExisting,
      type: TYPE_WASM_DEBUG_INFOS,
      source_url: this.sourceUrl,
    }
  }

  private getMetricsLogger() {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:wasm'],
      prefix: 'datadog.ci.wasm_symbols.',
    })

    return metricsLogger
  }

  private async getWasmSymbolFiles(symbolsLocation: string): Promise<WasmFileMetadata[]> {
    let paths: string[] = []
    let reportFailure: (message: string) => void

    const stat = await fs.promises.stat(symbolsLocation)
    if (stat.isDirectory()) {
      paths = await globAsync(buildPath(symbolsLocation, '**'), {dot: true, dotRelative: true})
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

    const filesMetadata: WasmFileMetadata[] = []
    for (const p of paths) {
      const pathStat = await fs.promises.lstat(p)
      if (pathStat.isDirectory()) {
        // check if directory is readable and if not emit a warning
        // eslint-disable-next-line no-bitwise
        await fs.promises.access(p, fs.constants.R_OK | fs.constants.X_OK).catch(() => {
          reportFailure(`Skipped directory ${p} because it is not readable`)
        })
      } else if (pathStat.isFile()) {
        // check that path is a WASM file
        const metadata = await getWasmFileMetadata(p)

        // handle all possible failures
        if (!metadata.isWasm) {
          reportFailure(`Input location ${p} is not a WASM file`)
          continue
        }
        if (metadata.error) {
          reportFailure(`Error reading WASM file ${p}: ${metadata.error.message}`)
          continue
        }
        if (!metadata.buildId) {
          reportFailure(`Skipped ${p} because it has no build id and no code section to derive one from`)
          continue
        }
        if (!metadata.hasDebugInfo && !metadata.hasExternalDebugInfo) {
          reportFailure(`Skipped ${p} because it has no embedded debug info, nor an external debug info reference`)
          continue
        }
        filesMetadata.push(metadata)
      }
    }

    // sort files to make output deterministic
    filesMetadata.sort((a, b) => a.filename.localeCompare(b.filename))

    return filesMetadata
  }

  private removeBuildIdDuplicates(filesMetadata: WasmFileMetadata[]): WasmFileMetadata[] {
    const buildIds = new Map<string, WasmFileMetadata>()
    for (const metadata of filesMetadata) {
      const buildId = getBuildIdWithArch(metadata)
      const existing = buildIds.get(buildId)
      if (existing) {
        if (metadata.hasDebugInfo && !existing.hasDebugInfo) {
          // if we have a duplicate build_id, we keep the one with embedded debug info
          this.context.stderr.write(
            renderWarning(
              `Duplicate build_id found: ${buildId} in ${metadata.filename} and ${existing.filename} - skipping ${existing.filename} because it has no embedded debug info`
            )
          )
          buildIds.set(buildId, metadata)
        } else {
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

  private async performWasmSymbolsUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    let wasmFilesMetadata = (
      await Promise.all(this.symbolsLocations.map((location) => this.getWasmSymbolFiles(location)))
    ).flat()
    wasmFilesMetadata = this.removeBuildIdDuplicates(wasmFilesMetadata)

    const requestBuilder = getWasmRequestBuilder(this.config.apiKey, this.cliVersion, this.config.datadogSite)

    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, wasmFilesMetadata, async (fileMetadata) => {
        const metadata = this.getMappingMetadata(fileMetadata)

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
              VALUE_NAME_WASM_DEBUG_INFOS,
              {
                type: 'file',
                path: fileMetadata.filename,
                options: {filename: WASM_DEBUG_INFOS_FILENAME},
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
            this.context.stdout.write(renderRetriedUpload(fileMetadata.filename, (e as Error).message, attempts))
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

    if (!isSupportedWasmArch(this.arch)) {
      this.context.stderr.write(renderArgumentMissingError(`arch (must be one of wasm32, wasm64, got "${this.arch}")`))
      parametersOkay = false
    }

    return parametersOkay
  }
}
