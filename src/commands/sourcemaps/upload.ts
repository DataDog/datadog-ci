import {Command} from 'clipanion'
import chalk from 'chalk'
import glob from 'glob'

export class UploadCommand extends Command {
  //private apiKey?: string
  private datadogSourcemapsDomain?: string
  private basePath: string = ''
  private releaseVersion?: string
  private service?: string
  private projectPath?: string
  private minifiedPath?: string

  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }

  public async execute() {
      this.context.stdout.write("Uploading sourcemaps.\n")
      if (!this.releaseVersion) {
          this.context.stderr.write("Missing release version\n")
          return 1
      }
      if (!this.service) {
          this.context.stderr.write("Missing service\n")
          return 1
      }
      if (!this.minifiedPath) {
          this.context.stderr.write("Missing minified path\n")
          return 1
      }
      if (!this.basePath.endsWith('/')) {
          this.basePath = this.basePath + '/'
      }
      let sourcemapFiles = glob.sync(`${this.basePath}**/*.min.js.map`, {})
      sourcemapFiles.forEach((s) => this.uploadSourcemap(s))

  }

  private uploadSourcemap(path: string) {
    this.context.stdout.write(path + '\n')
  }

  private getApiHelper() {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    return apiConstructor({
      apiKey: this.config.apiKey!,
      appKey: this.config.appKey!,
      baseIntakeUrl: this.getDatadogHost(true),
      baseUrl: this.getDatadogHost(),
      proxyOpts: this.config.proxy,
    })
  }

  private getSourcemapsUrl(): string {
      let domain = this.datadogSourcemapsDomain || 'https://sourcemaps.datadoghq.com/'
      if (!domain.endsWith('/')) {
          domain = domain + '/'
      }
      return domain + 'v1/input'
  }
}

UploadCommand.addPath('sourcemaps', 'upload')
UploadCommand.addOption('basePath', Command.String({required: true}))
UploadCommand.addOption('datadogSourcemapsDomain', Command.String('--datadog-sourcemaps-domain'))
UploadCommand.addOption('releaseVersion', Command.String('--release-version'))
UploadCommand.addOption('service', Command.String('--service'))
UploadCommand.addOption('minifiedPath', Command.String('--minified-path'))
UploadCommand.addOption('projectPath', Command.String('--project-path'))
