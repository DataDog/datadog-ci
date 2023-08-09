import fs from 'fs'
import path from 'path'

import type {ErrorObject} from 'ajv'

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath} from '../../helpers/utils'
import * as validation from '../../helpers/validation'

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
  renderFilesNotFound,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

const errorCodesStopUpload = [400, 403]

const validateSarif = (sarifReportPath: string) => {
  const ajv = new Ajv({allErrors: true})
  addFormats(ajv)
  const sarifJsonSchemaValidate = ajv.compile(sarifJsonSchema)
  try {
    const sarifReportContent = JSON.parse(String(fs.readFileSync(sarifReportPath)))
    const valid = sarifJsonSchemaValidate(sarifReportContent)
    if (!valid) {
      const errors = sarifJsonSchemaValidate.errors || []
      const errorMessages = errors.map((error: ErrorObject) => {
        return `${error.instancePath}: ${error.message}`
      })

      return errorMessages.join('\n')
    }
  } catch (error) {
    return error.message
  }

  return undefined
}

export class UploadSarifReportCommand extends Command {
  public static paths = [['sarif', 'upload']]

  public static usage = Command.Usage({
    category: 'Static Analysis',
    description: 'Upload SARIF reports files to Datadog.',
    details: `
      This command will upload SARIF reports files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all SARIF report files in current directory', 'datadog-ci sarif upload --service my-service .'],
      [
        'Upload all SARIF report files in src/sarif-go-reports and src/sarif-java-reports',
        'datadog-ci sarif upload --service my-service src/sarif-go-reports src/sarif-java-reports',
      ],
      [
        'Upload all SARIF report files in current directory and add extra tags globally',
        'datadog-ci sarif upload --service my-service --tags key1:value1 --tags key2:value2 .',
      ],
      [
        'Upload all SARIF report files in current directory to the datadoghq.eu site',
        'DATADOG_SITE=datadoghq.eu datadog-ci sarif upload --service my-service .',
      ],
    ],
  })

  private basePaths = Option.Rest({required: 1})
  private dryRun = Option.Boolean('--dry-run', false)
  private env = Option.String('--env')
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private service = Option.String('--service')
  private tags = Option.Array('--tags')
  private noVerify = Option.Boolean('--no-verify', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }

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

    const spanTags = await this.getSpanTags()
    const payloads = await this.getMatchingSarifReports(spanTags)

    if (payloads.length === 0) {
      this.context.stdout.write(renderFilesNotFound(this.basePaths, this.service))

      return 1
    }

    this.context.stdout.write(
      renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun, this.noVerify)
    )
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
      if (this.noVerify) {
        return true
      }

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
