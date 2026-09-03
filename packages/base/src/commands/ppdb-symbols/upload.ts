import fs from 'fs'

import type {MappingMetadata} from './interfaces'
import type {DebugIdManifest} from './manifest'
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
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
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

import {getPpdbSymbolsRequestBuilder, uploadMultipartHelper} from './helpers'
import {PORTABLE_PDB_FILENAME, TYPE_PORTABLE_PDB, VALUE_NAME_PORTABLE_PDB} from './interfaces'
import {lookupDebugId, readDebugIdManifest} from './manifest'
import {
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderEventPayload,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidManifest,
  renderInvalidSymbolsLocation,
  renderManifestNotFound,
  renderMissingManifestEntry,
  renderRetriedUpload,
  renderUpload,
} from './renderer'

export class PpdbSymbolsUploadCommand extends BaseCommand {
  public static paths = [['ppdb-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload .NET MAUI Portable PDBs to Datadog.',
    details: `
      This command uploads Portable PDB debug info for first-party/project .NET MAUI assemblies found
      recursively in the given location(s), correlated by the debug ID manifest generated at build time
      by dd-sdk-maui, in order to symbolicate managed exception stack traces.
    `,
    examples: [
      [
        'Upload Portable PDBs for all assemblies in the given directory',
        'datadog-ci ppdb-symbols upload ./bin/Release/net8.0-android --debug-id-manifest ./obj/Release/net8.0-android/dd_debug_ids.json',
      ],
    ],
  })

  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')
  private replaceExisting = Option.Boolean('--replace-existing', false)
  private debugIdManifestPath = Option.String('--debug-id-manifest', {required: true})
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

    let manifest: DebugIdManifest
    try {
      manifest = readDebugIdManifest(this.debugIdManifestPath)
    } catch (e) {
      this.context.stderr.write(renderInvalidManifest(this.debugIdManifestPath, (e as Error).message))

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
      callResults.push(...(await this.performPpdbSymbolsUpload(manifest)))

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

  private getMappingMetadata(assemblyName: string, debugId: string, pdbPath: string): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      origin_version: this.cliVersion,
      origin: 'datadog-ci',
      type: TYPE_PORTABLE_PDB,
      debug_id: debugId,
      assembly_name: assemblyName,
      filename: upath.basename(pdbPath),
      overwrite: this.replaceExisting,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
    }
  }

  private getMetricsLogger() {
    return getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:maui'],
      prefix: 'datadog.ci.ppdb_symbols.',
    })
  }

  private async getPdbFiles(symbolsLocation: string): Promise<string[]> {
    const stat = await fs.promises.stat(symbolsLocation)

    let paths: string[]
    if (stat.isDirectory()) {
      // strict: false is needed to avoid throwing an error if a directory is not readable
      paths = globSync(buildPath(symbolsLocation, '**/*.pdb'), {dot: true, dotRelative: true})

      // throw an error if top-level directory is not readable
      // eslint-disable-next-line no-bitwise
      await fs.promises.access(symbolsLocation, fs.constants.R_OK | fs.constants.X_OK).catch(() => {
        throw Error(`Directory ${symbolsLocation} is not readable`)
      })
    } else {
      if (upath.extname(symbolsLocation).toLowerCase() !== '.pdb') {
        throw Error(`${symbolsLocation} is not a .pdb file`)
      }
      paths = [symbolsLocation]
    }

    return paths.sort((a, b) => a.localeCompare(b))
  }

  private async performPpdbSymbolsUpload(manifest: DebugIdManifest): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)

    const pdbPaths = (await Promise.all(this.symbolsLocations.map((location) => this.getPdbFiles(location)))).flat()

    const requestBuilder = getPpdbSymbolsRequestBuilder(this.config.apiKey, this.cliVersion, this.config.datadogSite)

    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, pdbPaths, async (pdbPath) => {
        const assemblyName = upath.basename(pdbPath, '.pdb')
        const debugId = lookupDebugId(manifest, assemblyName)

        if (debugId === undefined) {
          this.context.stdout.write(renderMissingManifestEntry(assemblyName, pdbPath))

          return UploadStatus.Skipped
        }

        const metadata = this.getMappingMetadata(assemblyName, debugId, pdbPath)

        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload(pdbPath, metadata)}`)

          return UploadStatus.Success
        }

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
              VALUE_NAME_PORTABLE_PDB,
              {
                type: 'file',
                path: pdbPath,
                options: {filename: PORTABLE_PDB_FILENAME},
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
            this.context.stdout.write(renderFailedUpload(pdbPath, e.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (e, attempts) => {
            this.context.stdout.write(renderRetriedUpload(pdbPath, (e as Error).message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => {
            this.context.stdout.write(renderUpload(pdbPath, metadata))
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

    if (!this.debugIdManifestPath || !fs.existsSync(this.debugIdManifestPath)) {
      this.context.stderr.write(renderManifestNotFound(this.debugIdManifestPath))
      parametersOkay = false
    }

    return parametersOkay
  }
}
