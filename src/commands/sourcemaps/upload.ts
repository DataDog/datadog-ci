import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {getMetricsLogger} from './metrics'
import {renderFailedUpload, renderRetriedUpload, renderSuccessfulCommand} from './renderer'
import {buildPath, getMinifiedFilePath} from './utils'

export class UploadCommand extends Command {
  private basePath?: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSourcemapsDomain: process.env.DATADOG_SOURCE_MAPS_DOMAIN,
    poolLimit: parseInt(process.env.DATADOG_SOURCE_MAPS_POOL_LIMIT!, 10) || 20,
  }
  private minifiedPathPrefix?: string
  private projectPath = ''
  private releaseVersion?: string
  private service?: string

  public async execute() {
    this.context.stdout.write('Uploading sourcemaps.\n')
    if (!this.releaseVersion) {
      this.context.stderr.write('Missing release version\n')

      return 1
    }

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }
    if (!this.minifiedPathPrefix) {
      this.context.stderr.write('Missing minified path\n')

      return 1
    }

    const api = this.getApiHelper()
    const metricsLogger = getMetricsLogger(this.releaseVersion, this.service)
    const payloads = this.getMatchingSourcemapFiles()
    const upload = (p: Payload) => this.uploadSourcemap(api, metricsLogger, p)
    const initialTime = new Date().getTime()
    await asyncPool(this.config.poolLimit, payloads, upload)
    const totalTimeSeconds = (new Date().getTime() - initialTime) / 1000
    this.context.stdout.write(renderSuccessfulCommand(payloads.length, totalTimeSeconds))
    metricsLogger.gauge('duration', totalTimeSeconds)
    metricsLogger.flush()
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }
    if (!this.config.datadogSourcemapsDomain) {
      this.config.datadogSourcemapsDomain = 'https://sourcemaps.datadoghq.com/'
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      baseIntakeUrl: this.config.datadogSourcemapsDomain!,
    })
  }

  private getMatchingSourcemapFiles(): Payload[] {
    const sourcemapFiles = glob.sync(buildPath(this.basePath!, '**/*.min.js.map'))

    return sourcemapFiles.map((sourcemapPath) => {
      const minifiedFilePath = getMinifiedFilePath(sourcemapPath)

      return {
        minifiedFilePath,
        minifiedUrl: this.getMinifiedURL(minifiedFilePath),
        projectPath: this.projectPath,
        service: this.service!,
        sourcemapPath,
        version: this.releaseVersion!,
      }
    })
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath!, '')

    return buildPath(this.minifiedPathPrefix!, relativePath)
  }

  private async uploadSourcemap(
    api: APIHelper,
    metricsLogger: BufferedMetricsLogger,
    sourcemap: Payload
  ): Promise<void> {
    try {
      await retry(
        async () => {
          // TODO [alexc] in case un-recoverable errors happen, bail
          await api.uploadSourcemap(sourcemap)
          metricsLogger.increment('success', 1)
        },
        {
          onRetry: (e, attempt) => {
            metricsLogger.increment('retries', 1)
            this.context.stdout.write(renderRetriedUpload(sourcemap, e.message, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      metricsLogger.increment('failed', 1)
      this.context.stdout.write(renderFailedUpload(sourcemap, error))
    }

    return
  }
}

UploadCommand.addPath('sourcemaps', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('minifiedPathPrefix', Command.String('--minified-path-prefix'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
