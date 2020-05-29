import chalk from 'chalk'
import {Command} from 'clipanion'
import glob from 'glob'
import {apiConstructor} from './api'
import {Payload} from './interfaces'

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
    sourcemapFiles.forEach((sourcemapPath) => {
      const minifiedFilePath = this.getMinifiedFilePath(sourcemapPath)
      const s: Payload = {
        minifiedFilePath,
        minifiedUrl: this.getMinifiedURL(minifiedFilePath),
        service: this.service,
        sourcemapPath,
        version: this.releaseVersion,
      }
      api.uploadSourcemap(s).then((res)=> console.log('ok'))
    })
  }

  private getMinifiedURL(minifiedFilePath: string): string {
    const relativePath = minifiedFilePath.replace(this.basePath, '')

    return this.buildPath(this.minifiedPathPrefix, relativePath)
  }

  private getMinifiedFilePath(sourcemapPath: string): string {
    return sourcemapPath.replace('.min.js.map', '.min.js')
  }

  private buildPath = (...args: string[]) => {
    return args
      .map((part, i) => {
        if (i === 0) {
          return part.trim().replace(/[\/]*$/g, '')
        } else {
          return part.trim().replace(/(^[\/]*|[\/]*$)/g, '')
        }
      })
      .filter((x) => x.length)
      .join('/')
  }

  private getApiHelper() {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      baseIntakeUrl: this.getSourcemapsUrl(),
    })
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
