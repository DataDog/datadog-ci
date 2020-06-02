import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'
import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {getMetricsLogger} from './metrics'
import {renderFailedUpload, renderRetriedUpload} from './renderer'
import {buildPath, getMinifiedFilePath} from './utils'

export class UploadCommand extends Command {
  private basePath = ''
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    datadogSourcemapsDomain: process.env.DATADOG_SOURCE_MAPS_DOMAIN,
  }
  private minifiedPathPrefix = ''
  private poolLimit = 20
  private projectPath = ''
  private releaseVersion = ''
  private service = ''

  public async execute() {
    const api = this.getApiHelper()
    const metricsLogger = getMetricsLogger(this.releaseVersion, this.service)
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
    if (!this.basePath.endsWith('/')) {
      this.basePath = this.basePath + '/'
    }

    const sourcemapFiles = glob.sync(`${this.basePath}**/*.min.js.map`, {})
    const payloads = sourcemapFiles.map((sourcemapPath) => {
      const minifiedFilePath = getMinifiedFilePath(sourcemapPath)

      return {
        minifiedFilePath,
        minifiedUrl: this.getMinifiedURL(minifiedFilePath),
        projectPath: this.projectPath,
        service: this.service,
        sourcemapPath,
        version: this.releaseVersion,
      }
    })
    const fileCount = payloads.length
    const upload = (p: Payload) => this.uploadSourcemap(api, metricsLogger, p)
    const initialTime = new Date().getTime()
    await asyncPool(this.poolLimit, payloads, upload)
    const totalTimeSeconds = (new Date().getTime() - initialTime) / 1000
    this.context.stdout.write(`Uploaded ${fileCount} files in ${totalTimeSeconds} seconds.`)
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

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath, '')

    return buildPath(this.minifiedPathPrefix, relativePath)
  }

  private async uploadSourcemap(
    api: APIHelper,
    metricsLogger: BufferedMetricsLogger,
    sourcemap: Payload
  ): Promise<void> {
    try {
      await retry(
        async (bail, attempt) => {
          await api.uploadSourcemap(sourcemap)
          metricsLogger.increment('success', 1)
        },
        {
          onRetry: (e, attempt) => {
            metricsLogger.increment('retries', 1)
            this.context.stdout.write(renderRetriedUpload(sourcemap, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      metricsLogger.increment('failed', 1)
      this.context.stdout.write(renderFailedUpload(sourcemap))
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
