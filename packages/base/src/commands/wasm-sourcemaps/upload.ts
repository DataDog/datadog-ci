import fs from 'fs'
import {URL} from 'url'

import type {WasmSourcemapFile, WasmSourcemapMetadata} from './interfaces'
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

import {getWasmSourcemapRequestBuilder, uploadMultipartHelper} from './helpers'
import {SOURCE_MAP_FILE_NAME, TYPE_WASM_SOURCEMAP, VALUE_NAME_SOURCE_MAP} from './interfaces'
import {
  renderCommandInfo,
  renderCommandSummary,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidLocation,
  renderInvalidPrefix,
  renderInvalidSourcemapFilename,
  renderMissingModule,
  renderMissingOption,
  renderRetriedUpload,
  renderUpload,
} from './renderer'

export class WasmSourcemapsUploadCommand extends BaseCommand {
  public static paths = [['wasm-sourcemaps', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload WebAssembly sourcemaps to Datadog.',
    details: `
      This command uploads *.wasm.map files and associates each one with the public URL of its corresponding
      WebAssembly module. Datadog uses the sourcemaps to deobfuscate WASM stack frames.
    `,
    examples: [
      [
        'Upload all WASM sourcemaps in a build directory',
        'datadog-ci wasm-sourcemaps upload ./build/web --service my-service --release-version 1.0.0 --minified-path-prefix https://static.example.com/app/',
      ],
    ],
  })

  private basePath = Option.String({required: true})
  private service = Option.String('--service')
  private releaseVersion = Option.String('--release-version')
  private minifiedPathPrefix = Option.String('--minified-path-prefix')
  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private repositoryUrl = Option.String('--repository-url')

  private cliVersion = cliVersion
  private config: Record<string, string> = {datadogSite: 'datadoghq.com'}
  private gitData?: RepositoryData

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    if (!this.verifyParameters()) {
      return 1
    }

    this.basePath = upath.normalize(this.basePath)
    this.context.stdout.write(
      renderCommandInfo(this.dryRun, this.basePath, this.service!, this.releaseVersion!, this.minifiedPathPrefix!)
    )

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

    const initialTime = Date.now()
    try {
      const statuses = await this.performUpload()
      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderCommandSummary(statuses, totalTime, this.dryRun))

      return statuses.some((status) => status === UploadStatus.Failure) ? 1 : 0
    } catch (error) {
      this.context.stderr.write(renderGeneralizedError(error))

      return 1
    }
  }

  private verifyParameters(): boolean {
    let valid = true

    if (!fs.existsSync(this.basePath)) {
      this.context.stderr.write(renderInvalidLocation(this.basePath))
      valid = false
    } else {
      const stat = fs.statSync(this.basePath)
      if (!stat.isDirectory() && !stat.isFile()) {
        this.context.stderr.write(renderInvalidLocation(this.basePath))
        valid = false
      } else if (stat.isFile() && !this.basePath.endsWith('.wasm.map')) {
        this.context.stderr.write(renderInvalidSourcemapFilename(this.basePath))
        valid = false
      }
    }
    if (!this.service) {
      this.context.stderr.write(renderMissingOption('--service'))
      valid = false
    }
    if (!this.releaseVersion) {
      this.context.stderr.write(renderMissingOption('--release-version'))
      valid = false
    }
    if (!this.minifiedPathPrefix) {
      this.context.stderr.write(renderMissingOption('--minified-path-prefix'))
      valid = false
    } else if (!this.isMinifiedPathPrefixValid()) {
      this.context.stderr.write(renderInvalidPrefix())
      valid = false
    }

    return valid
  }

  private isMinifiedPathPrefixValid(): boolean {
    try {
      if (new URL(this.minifiedPathPrefix!).host) {
        return true
      }
    } catch {
      // Absolute paths are also supported.
    }

    return this.minifiedPathPrefix!.startsWith('/')
  }

  private async getWasmSourcemapFiles(): Promise<WasmSourcemapFile[]> {
    const stat = await fs.promises.stat(this.basePath)
    const sourcemapPaths = stat.isDirectory()
      ? await globAsync(buildPath(this.basePath, '**/*.wasm.map'), {dot: true, dotRelative: true})
      : [this.basePath]
    const relativeRoot = stat.isDirectory() ? this.basePath : upath.dirname(this.basePath)
    const files: WasmSourcemapFile[] = []

    for (const sourcemapPath of sourcemapPaths.sort()) {
      if (!sourcemapPath.endsWith('.wasm.map')) {
        continue
      }
      const modulePath = sourcemapPath.slice(0, -'.map'.length)
      if (!fs.existsSync(modulePath)) {
        this.context.stdout.write(renderMissingModule(modulePath))
        continue
      }
      const relativeModulePath = upath.relative(relativeRoot, modulePath)
      files.push({
        modulePath,
        moduleUrl: buildPath(this.minifiedPathPrefix!, relativeModulePath),
        sourcemapPath,
      })
    }

    return files
  }

  private getMetadata(file: WasmSourcemapFile): WasmSourcemapMetadata {
    return {
      cli_version: this.cliVersion,
      minified_url: file.moduleUrl,
      service: this.service!,
      type: TYPE_WASM_SOURCEMAP,
      version: this.releaseVersion!,
    }
  }

  private async performUpload(): Promise<UploadStatus[]> {
    const metricsLogger = this.getMetricsLogger()
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
    const requestBuilder = getWasmSourcemapRequestBuilder(this.config.apiKey, this.cliVersion, this.config.datadogSite)
    const files = await this.getWasmSourcemapFiles()

    try {
      return await doWithMaxConcurrency(this.maxConcurrency, files, async (file) => {
        const metadata = this.getMetadata(file)
        if (this.dryRun) {
          this.context.stdout.write(`[DRYRUN] ${renderUpload(file.sourcemapPath, metadata)}`)

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
              VALUE_NAME_SOURCE_MAP,
              {
                type: 'file',
                path: file.sourcemapPath,
                options: {filename: SOURCE_MAP_FILE_NAME},
              },
            ],
          ]),
        }
        if (this.gitData) {
          payload.content.set('repository', this.getGitDataPayload(this.gitData))
        }

        return uploadMultipartHelper(requestBuilder, payload, {
          apiKeyValidator,
          onError: (error) => {
            this.context.stdout.write(renderFailedUpload(file.sourcemapPath, error.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (error, attempts) => {
            this.context.stdout.write(renderRetriedUpload(file.sourcemapPath, (error as Error).message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => this.context.stdout.write(renderUpload(file.sourcemapPath, metadata)),
          retries: 5,
          useGzip: true,
        })
      })
    } finally {
      try {
        await metricsLogger.flush()
      } catch (error) {
        this.context.stdout.write(`WARN: ${error}\n`)
      }
    }
  }

  private getMetricsLogger(): MetricsLogger {
    return getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [
        `cli_version:${this.cliVersion}`,
        `service:${this.service}`,
        `version:${this.releaseVersion}`,
        'platform:wasm',
      ],
      prefix: 'datadog.ci.wasm_sourcemaps.',
    })
  }

  private async getGitMetadata(): Promise<RepositoryData | undefined> {
    try {
      return await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
    } catch (error) {
      this.context.stdout.write(renderGitWarning(String(error)))

      return undefined
    }
  }

  private getGitDataPayload(gitData: RepositoryData): MultipartValue {
    return {
      type: 'string',
      options: {filename: 'repository', contentType: 'application/json'},
      value: JSON.stringify({
        data: [
          {
            files: gitData.trackedFilesMatcher.rawTrackedFilesList(),
            hash: gitData.hash,
            repository_url: gitData.remote,
          },
        ],
        version: 1,
      }),
    }
  }
}
