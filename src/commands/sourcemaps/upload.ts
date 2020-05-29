import chalk from 'chalk'
import {Command} from 'clipanion'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'
import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'

export class UploadCommand extends Command {
  private basePath = ''
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }
  private datadogSourcemapsDomain?: string
  private minifiedPathPrefix = ''
  private projectPath?: string
  private releaseVersion = ''
  private service = ''
  private poolLimit = 20

  public async execute() {
    const api = this.getApiHelper()
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
    const payloads = sourcemapFiles.map((sourcemapPath => {
      const minifiedFilePath = this.getMinifiedFilePath(sourcemapPath)
      return {
        minifiedFilePath,
        minifiedUrl: this.getMinifiedURL(minifiedFilePath),
        service: this.service,
        sourcemapPath,
        version: this.releaseVersion,
      }
    }))
    const fileCount = payloads.length
    const upload = (p: Payload) => this.uploadSourcemap(api, p)
    const initialTime = new Date().getTime()
    await asyncPool(this.poolLimit, payloads, upload)
    const totalTimeSeconds = (new Date().getTime() - initialTime) / 1000
    this.context.stdout.write(`Uploaded ${fileCount} files in ${totalTimeSeconds} seconds.`)
  }

  private uploadSourcemap(api: APIHelper, sourcemap: Payload): Promise<void> {
      return api.uploadSourcemap(sourcemap).then((_) => console.log('ok'))
  }

  private buildPath = (...args: string[]) => args
      .map((part, i) => {
        if (i === 0) {
          return part.trim().replace(/[\/]*$/g, '')
        } else {
          return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
        }
      })
      .filter((x) => x.length)
      .join('/')

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      baseIntakeUrl: this.getSourcemapsUrl(),
    })
  }

  private getMinifiedFilePath(sourcemapPath: string): string {
    return sourcemapPath.replace('.min.js.map', '.min.js')
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath, '')

    return this.buildPath(this.minifiedPathPrefix, relativePath)
  }

  private getSourcemapsUrl(): string {
    let domain = this.datadogSourcemapsDomain || 'https://sourcemaps.datadoghq.com/'
    if (!domain.endsWith('/')) {
      domain = domain + '/'
    }

    return domain
  }
}

UploadCommand.addPath('sourcemaps', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('datadogSourcemapsDomain', Command.String('--datadog-sourcemaps-domain'))
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('minifiedPathPrefix', Command.String('--minified-path-prefix'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
