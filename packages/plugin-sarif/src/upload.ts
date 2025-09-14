import fs from 'fs'

import {SarifUploadCommand} from '@datadog/datadog-ci-base/commands/sarif/upload-command'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {DatadogCiConfig} from '@datadog/datadog-ci-base/helpers/config'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {GIT_SHA, getSpanTags, getMissingRequiredGitTags} from '@datadog/datadog-ci-base/helpers/tags'
import {buildPath} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import upath from 'upath'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderSuccessfulCommand,
  renderDryRunUpload,
  renderRetriedUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderFilesNotFound,
  renderMissingTags,
} from './renderer'
import {getBaseIntakeUrl, getServiceFromSarifTool} from './utils'
import {checkForError, validateSarif} from './validation'

export class PluginCommand extends SarifUploadCommand {
  private config: DatadogCiConfig = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }

  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    // TODO(julien): remove this notice in April 2025
    if (this.serviceFromCli) {
      this.context.stderr.write(
        'The CLI flag `--service` is deprecated and will be removed in a future version of datadog-ci\n'
      )
      this.context.stderr.write(
        'To associate findings with services, consider using the service-to-repo mapping from service catalog\n'
      )
      this.context.stderr.write(
        'Learn more at https://docs.datadoghq.com/getting_started/code_security/?tab=staticcodeanalysissast#link-datadog-services-to-repository-scan-results\n'
      )
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
    this.basePaths = this.basePaths.map((basePath) => upath.normalize(basePath))

    const spanTags = await getSpanTags(this.config, this.tags, !this.noCiTags, this.gitPath)

    // Gather any missing mandatory git fields to display to the user
    const missingGitFields = getMissingRequiredGitTags(spanTags)
    if (missingGitFields.length > 0) {
      this.context.stdout.write(renderMissingTags(missingGitFields))

      return 1
    }

    const payloads = await this.getMatchingSarifReports(spanTags)

    if (payloads.length === 0) {
      this.context.stdout.write(renderFilesNotFound(this.basePaths))

      return 1
    }

    const sha = spanTags[GIT_SHA] || 'sha-not-found'
    const env = this.config.env || 'env-not-set'
    this.context.stdout.write(
      renderCommandInfo(this.basePaths, env, sha, this.maxConcurrency, this.dryRun, this.noVerify)
    )
    const upload = (payload: Payload) => this.uploadSarifReport(api, payload)

    const initialTime = new Date().getTime()

    await doWithMaxConcurrency(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(renderSuccessfulCommand(payloads.length, totalTimeSeconds))
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
      const isFile = !!upath.extname(basePath)
      if (isFile) {
        return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
      }

      return acc.concat(globSync(buildPath(basePath, '*.sarif'), {dotRelative: true}))
    }, [])

    const validUniqueFiles = [...new Set(sarifReports)].filter((sarifReport) => {
      if (this.noVerify) {
        return true
      }

      const validationErrorMessage = validateSarif(sarifReport)
      if (validationErrorMessage) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.context.stdout.write(renderInvalidFile(sarifReport, [validationErrorMessage]))

        return false
      }

      const potentialErrors = checkForError(sarifReport)
      if (potentialErrors.length > 0) {
        this.context.stdout.write(renderInvalidFile(sarifReport, potentialErrors))

        return false
      }

      return true
    })

    return validUniqueFiles.map((sarifReport) => {
      return {
        reportPath: sarifReport,
        spanTags,
        service: getServiceFromSarifTool(sarifReport),
      }
    })
  }
}
