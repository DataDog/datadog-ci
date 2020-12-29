import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import {BufferedMetricsLogger} from 'datadog-metrics'
import fs from 'fs'
import glob from 'glob'
import path from 'path'
import asyncPool from 'tiny-async-pool'
import {URL} from 'url'

import {apiConstructor} from './api'
import {filterTrackedFiles, getRepositoryData, newSimpleGit, RepositoryData} from './git'
import {APIHelper, Payload} from './interfaces'
import {getMetricsLogger} from './metrics'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedUpload,
  renderInvalidPrefix,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {buildPath, getBaseIntakeUrl, getMinifiedFilePath} from './utils'

const errorCodesNoRetry = [400, 403, 413]
const errorCodesStopUpload = [400, 403]

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload javascript sourcemaps to Datadog.',
    details: `
            This command will upload all javascript sourcemaps and their corresponding javascript file to Datadog in order to un-minify front-end stack traces received by Datadog.
            See README for details.
        `,
    examples: [
      [
        'Upload all sourcemaps in current directory',
        'datadog-ci sourcemaps upload . --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234',
      ],
      [
        'Upload all sourcemaps in /home/users/ci with 50 concurrent uploads',
        'datadog-ci sourcemaps upload . --service my-service --minified-path-prefix https://static.datadog.com --release-version 1.234 --concurency 50',
      ],
    ],
  })

  private basePath?: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }
  private disableGit?: boolean
  private dryRun = false
  private maxConcurrency = 20
  private minifiedPathPrefix?: string
  private projectPath = ''
  private releaseVersion?: string
  private repositoryURL?: string
  private service?: string

  public async execute() {
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

    if (!this.isMinifiedPathPrefixValid()) {
      this.context.stdout.write(renderInvalidPrefix)

      return 1
    }

    const api = this.getApiHelper()
    // Normalizing the basePath to resolve .. and .
    this.basePath = path.normalize(this.basePath!)
    this.context.stdout.write(
      renderCommandInfo(
        this.basePath!,
        this.minifiedPathPrefix,
        this.projectPath,
        this.releaseVersion,
        this.service,
        this.maxConcurrency,
        this.dryRun
      )
    )
    const metricsLogger = getMetricsLogger(this.releaseVersion, this.service)
    let payloads = await this.getPayloadsToUpload()
    const useGit = this.disableGit === undefined || !this.disableGit
    if (useGit) {
      payloads = await this.addRepositoryDataToPayloads(payloads)
    }
    const upload = (p: Payload) => this.uploadSourcemap(api, metricsLogger, p)
    const initialTime = new Date().getTime()
    await asyncPool(this.maxConcurrency, payloads, upload)
    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(renderSuccessfulCommand(payloads.length, totalTimeSeconds))
    metricsLogger.gauge('duration', totalTimeSeconds)
    metricsLogger.flush()
  }

  // AddRepositoryDataToPayloads fills the 'repository' field of each payload with data gathered using git.
  private addRepositoryDataToPayloads = async (payloads: Payload[]): Promise<Payload[]> => {
    const simpleGit = newSimpleGit()
    const repositoryData = await getRepositoryData(simpleGit, this.context.stdout, this.repositoryURL)
    if (repositoryData === undefined) {
      return payloads
    }

    return Promise.all(
      payloads.map(async (payload) => {
        let repositoryPayload: string | undefined
        repositoryPayload = await this.getRepositoryPayload(repositoryData, payload.sourcemapPath)

        return {
          ...payload,
          repository: repositoryPayload,
        }
      })
    )
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey!)
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath!, '')

    return buildPath(this.minifiedPathPrefix!, relativePath)
  }

  // GetPayloadsToUpload looks for the sourcemaps and minified files on disk and returns
  // the associated payloads.
  private getPayloadsToUpload = async (): Promise<Payload[]> => {
    const sourcemapFiles = glob.sync(buildPath(this.basePath!, '**/*.js.map'))

    return Promise.all(
      sourcemapFiles.map(async (sourcemapPath) => {
        const minifiedFilePath = getMinifiedFilePath(sourcemapPath)
        const minifiedURL = this.getMinifiedURL(minifiedFilePath)

        return {
          minifiedFilePath,
          minifiedUrl: minifiedURL,
          projectPath: this.projectPath,
          service: this.service!,
          sourcemapPath,
          version: this.releaseVersion!,
        }
      })
    )
  }

  // GetRepositoryPayload generates the repository payload for a specific sourcemap.
  // It specifically looks for the list of tracked files that are associated to the source paths
  // declared inside the sourcemap.
  private getRepositoryPayload = async (
    repositoryData: RepositoryData,
    sourcemapPath: string
  ): Promise<string | undefined> => {
    let repositoryPayload: string | undefined
    const files = await filterTrackedFiles(
      this.context.stdout,
      sourcemapPath,
      this.projectPath,
      repositoryData.trackedFiles
    )
    if (files) {
      repositoryPayload = JSON.stringify({
        files,
        hash: repositoryData.hash,
        repository_url: repositoryData.remote,
      })
    }

    return repositoryPayload
  }

  private isMinifiedPathPrefixValid(): boolean {
    let protocol
    try {
      const objUrl = new URL(this.minifiedPathPrefix!)
      protocol = objUrl.protocol
    } catch {
      // Do nothing.
    }

    if (!protocol && !this.minifiedPathPrefix!.startsWith('/')) {
      return false
    }

    return true
  }

  private async uploadSourcemap(api: APIHelper, metricsLogger: BufferedMetricsLogger, sourcemap: Payload) {
    if (!fs.existsSync(sourcemap.minifiedFilePath)) {
      this.context.stdout.write(
        renderFailedUpload(sourcemap, `Missing corresponding JS file for sourcemap (${sourcemap.minifiedFilePath})`)
      )
      metricsLogger.increment('skipped_missing_js', 1)

      return
    }

    try {
      await retry(
        async (bail) => {
          try {
            if (this.dryRun) {
              this.context.stdout.write(renderDryRunUpload(sourcemap))

              return
            }
            await api.uploadSourcemap(sourcemap, this.context.stdout.write.bind(this.context.stdout))
            metricsLogger.increment('success', 1)
          } catch (error) {
            if (error.response) {
              // If it's an axios error
              if (!errorCodesNoRetry.includes(error.response.status)) {
                // And a status code that is not excluded from retries, throw the error so that upload is retried
                throw error
              }
            }
            // If it's another error or an axios error we don't want to retry, bail
            bail(error)

            return
          }
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
      if (error.response) {
        // If it's an axios error
        if (!errorCodesStopUpload.includes(error.response.status)) {
          // And a status code that should not stop the whole upload, just return
          return
        }
      }
      throw error
    }
  }
}

UploadCommand.addPath('sourcemaps', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('minifiedPathPrefix', Command.String('--minified-path-prefix'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
UploadCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
