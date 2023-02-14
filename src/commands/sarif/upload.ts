import fs from 'fs'
import path from 'path'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import chalk from 'chalk'
import {Command} from 'clipanion'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath} from '../../helpers/utils'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import sarifJsonSchema from './json-schema/sarif-schema-2.1.0.json'
import {
  renderCommandInfo,
  renderSuccessfulCommand,
  renderDryRunUpload,
  renderRetriedUpload,
  renderFailedUpload,
  renderInvalidFile,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

const errorCodesStopUpload = [400, 403]

const ajv = new Ajv()
addFormats(ajv)

const validateSarif = (sarifReportPath: string) => {
  const sarifJsonSchemaValidate = ajv.compile(sarifJsonSchema)
  try {
    const sarifReportContent = JSON.parse(String(fs.readFileSync(sarifReportPath)))
    const valid = sarifJsonSchemaValidate(sarifReportContent)
    if (!valid) {
      return sarifJsonSchemaValidate.errors
    }
  } catch (error) {
    return error.message
  }

  return undefined
}

export class UploadSarifReportCommand extends Command {
  public static usage = Command.Usage({})

  private basePaths?: string[]
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }
  private dryRun = false
  private env?: string
  private maxConcurrency = 20
  private service?: string
  private tags?: string[]

  public async execute() {
    if (!this.service) {
      this.service = process.env.DD_SERVICE
    }

    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }
    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }
    if (!this.config.env) {
      this.config.env = this.env
    }

    const api = this.getApiHelper()
    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
    this.context.stdout.write(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

    const spanTags = await this.getSpanTags()
    const payloads = await this.getMatchingSarifReports(spanTags)
    const upload = (p: Payload) => this.uploadSarifReport(api, p)

    const initialTime = new Date().getTime()

    await asyncPool(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(
      renderSuccessfulCommand(payloads.length, totalTimeSeconds, spanTags, this.service, this.config.env)
    )
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...cliTags,
      ...envVarTags,
      ...(this.config.env ? {env: this.config.env} : {}),
    }
  }

  private async uploadSarifReport(api: APIHelper, sarifReport: Payload) {
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunUpload(sarifReport))

      return
    }

    try {
      await retryRequest(
        () => api.uploadSarifReport(sarifReport, this.context.stdout.write.bind(this.context.stdout)),
        {
          onRetry: (e, attempt) => {
            this.context.stderr.write(renderRetriedUpload(sarifReport, e.message, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(sarifReport, error))
      if (error.message) {
        // If it's an axios error
        if (!errorCodesStopUpload.includes(error.response.status)) {
          // And a status code that should not stop the whole upload, just return
          return
        }
      }
      throw error
    }
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey)
  }

  private async getMatchingSarifReports(spanTags: SpanTags): Promise<Payload[]> {
    const sarifReports = (this.basePaths || []).reduce((acc: string[], basePath: string) => {
      const isFile = !!path.extname(basePath)
      if (isFile) {
        return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
      }

      return acc.concat(glob.sync(buildPath(basePath, '*.sarif')))
    }, [])

    const validUniqueFiles = [...new Set(sarifReports)].filter((sarifReport) => {
      const validationErrorMessage = validateSarif(sarifReport)
      if (validationErrorMessage) {
        this.context.stdout.write(renderInvalidFile(sarifReport, validationErrorMessage))

        return false
      }

      return true
    })

    return validUniqueFiles.map((sarifReport) => ({
      service: this.service!,
      reportPath: sarifReport,
      spanTags,
    }))
  }
}
UploadSarifReportCommand.addPath('sarif', 'upload')
UploadSarifReportCommand.addOption('service', Command.String('--service'))
UploadSarifReportCommand.addOption('env', Command.String('--env'))
UploadSarifReportCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadSarifReportCommand.addOption('tags', Command.Array('--tags'))
UploadSarifReportCommand.addOption('basePaths', Command.Rest({required: 1}))
UploadSarifReportCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
