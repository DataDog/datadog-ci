import fs from 'fs'
import os from 'os'

import {newSimpleGit} from '@datadog/datadog-ci-base/commands/git-metadata/git'
import {uploadToGitDB} from '@datadog/datadog-ci-base/commands/git-metadata/gitdb'
import {isGitRepo} from '@datadog/datadog-ci-base/commands/git-metadata/library'
import {JunitUploadCommand} from '@datadog/datadog-ci-base/commands/junit/upload'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {findFiles} from '@datadog/datadog-ci-base/helpers/file-finder'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getGitMetadata} from '@datadog/datadog-ci-base/helpers/git/format-git-span-data'
import {parsePathsList} from '@datadog/datadog-ci-base/helpers/glob'
import id from '@datadog/datadog-ci-base/helpers/id'
import {SpanTags, RequestBuilder} from '@datadog/datadog-ci-base/helpers/interfaces'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {parseTags, parseMetrics} from '@datadog/datadog-ci-base/helpers/tags'
import {getUserGitSpanTags} from '@datadog/datadog-ci-base/helpers/user-provided-git'
import {getRequestBuilder, timedExecAsync} from '@datadog/datadog-ci-base/helpers/utils'
import chalk from 'chalk'
import {XMLParser, XMLValidator} from 'fast-xml-parser'
import upath from 'upath'

import {apiConstructor, apiUrl, intakeUrl} from '../api'
import {APIHelper, Payload} from '../interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedUpload,
  renderFailedGitDBSync,
  renderInvalidFile,
  renderRetriedUpload,
  renderSuccessfulCommand,
  renderSuccessfulGitDBSync,
  renderSuccessfulUpload,
  renderUpload,
} from '../renderer'

const TRACE_ID_HTTP_HEADER = 'x-datadog-trace-id'
const PARENT_ID_HTTP_HEADER = 'x-datadog-parent-id'
const errorCodesStopUpload = [400, 403]

const isJunitXmlReport = (file: string): boolean => {
  if (upath.extname(file) !== '.xml') {
    return false
  }

  const filename = upath.basename(file)

  return (
    filename.includes('junit') || // *junit*.xml
    filename.includes('test') || // *test*.xml
    filename.includes('TEST-') // *TEST-*.xml
  )
}

const validateXml = (xmlFilePath: string) => {
  const xmlFileContentString = String(fs.readFileSync(xmlFilePath))
  const validationOutput = XMLValidator.validate(xmlFileContentString)
  if (validationOutput !== true) {
    return validationOutput.err.msg
  }
  const xmlParser = new XMLParser()
  const xmlFileJSON = xmlParser.parse(String(xmlFileContentString))
  if (!('testsuites' in xmlFileJSON) && !('testsuite' in xmlFileJSON)) {
    return 'Neither <testsuites> nor <testsuite> are the root tag.'
  } else if (!xmlFileJSON.testsuite && !xmlFileJSON.testsuites) {
    return 'The junit report file is empty, there are no <testcase> elements.'
  }

  return undefined
}

export class PluginCommand extends JunitUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMetrics: process.env.DD_METRICS,
    envVarMeasures: process.env.DD_MEASURES,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private xpathTags?: Record<string, string>
  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    if (!this.config.env) {
      this.config.env = this.env
    }

    if (this.rawXPathTags) {
      this.xpathTags = this.parseXPathTags(this.rawXPathTags)
      if (Object.keys(this.xpathTags).length !== this.rawXPathTags.length) {
        return 1
      }
    }

    const api = this.getApiHelper()

    // Normalizing the basePath to resolve .. and .
    this.basePaths = this.basePaths.map((basePath) => upath.normalize(basePath))
    this.logger.info(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

    const spanTags = await this.getSpanTags()
    const customTags = this.getCustomTags()
    const customMeasures = this.getCustomMeasures()
    const reportTags = this.getReportTags()
    const reportMeasures = this.getReportMeasures()
    const payloads = await this.getMatchingJUnitXMLFiles(
      spanTags,
      customTags,
      customMeasures,
      reportTags,
      reportMeasures
    )
    const upload = (p: Payload) => this.uploadJUnitXML(api, p)

    const initialTime = new Date().getTime()

    await doWithMaxConcurrency(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.logger.info(renderSuccessfulUpload(this.dryRun, payloads.length, totalTimeSeconds))

    if (!this.skipGitMetadataUpload) {
      if (await isGitRepo()) {
        const traceId = id()

        const requestBuilder = getRequestBuilder({
          baseUrl: apiUrl,
          apiKey: this.config.apiKey!,
          headers: new Map([
            [TRACE_ID_HTTP_HEADER, traceId],
            [PARENT_ID_HTTP_HEADER, traceId],
          ]),
        })
        try {
          this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Syncing git metadata...`)
          let elapsed = 0
          if (!this.dryRun) {
            elapsed = await timedExecAsync(this.uploadToGitDB.bind(this), {requestBuilder})
          }
          this.logger.info(renderSuccessfulGitDBSync(this.dryRun, elapsed))
        } catch (err) {
          this.logger.info(renderFailedGitDBSync(err))
        }
      } else {
        this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Not syncing git metadata (not a git repo)`)
      }
    } else {
      this.logger.debug('Not syncing git metadata (skip git upload flag detected)')
    }

    if (!this.dryRun) {
      this.context.stdout.write(renderSuccessfulCommand(spanTags, this.service, this.config.env))
    }
  }

  private async uploadToGitDB(opts: {requestBuilder: RequestBuilder}) {
    await uploadToGitDB(this.logger, opts.requestBuilder, await newSimpleGit(), this.dryRun, this.gitRepositoryURL)
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )
      throw new Error('API key is missing')
    }

    return apiConstructor(intakeUrl, this.config.apiKey)
  }

  private parseXPathTags(rawXPathTags: string[]): Record<string, string> {
    return rawXPathTags.reduce((xpathTags: Record<string, string>, rawExpression: string) => {
      const index = rawExpression.indexOf('=')
      if (index === -1) {
        this.context.stderr.write('Invalid xpath-tag: missing =. Value must be <tag>=<xpath-expression>\n')

        return xpathTags
      }

      const tagName = rawExpression.substring(0, index)
      const xPath = rawExpression.substring(index + 1)
      xpathTags[tagName] = xPath

      return xpathTags
    }, {})
  }

  private async getMatchingJUnitXMLFiles(
    spanTags: SpanTags,
    customTags: Record<string, string>,
    customMeasures: Record<string, number>,
    reportTags: Record<string, string>,
    reportMeasures: Record<string, number>
  ): Promise<Payload[]> {
    let basePaths
    let searchFoldersRecursively
    let filterFile: (file: string) => boolean
    if (this.automaticReportsDiscovery) {
      basePaths = this.basePaths || ['.']
      searchFoldersRecursively = true
      filterFile = isJunitXmlReport
    } else {
      // maintaining legacy matching logic for backward compatibility
      basePaths = this.basePaths || []
      searchFoldersRecursively = false
      filterFile = (file) => upath.extname(file) === '.xml'
    }

    const validUniqueFiles = findFiles(
      basePaths,
      searchFoldersRecursively,
      parsePathsList(this.ignoredPaths),
      filterFile,
      validateXml,
      (filePath: string, errorMessage: string) => this.context.stdout.write(renderInvalidFile(filePath, errorMessage))
    )

    return validUniqueFiles.map((jUnitXMLFilePath) => ({
      hostname: os.hostname(),
      logsEnabled: this.logs,
      xpathTags: this.xpathTags,
      spanTags,
      customTags,
      customMeasures,
      reportTags,
      reportMeasures,
      xmlPath: jUnitXMLFilePath,
    }))
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...(this.config.env ? {env: this.config.env} : {}),
      service: this.service!,
    }
  }

  private getCustomTags(): Record<string, string> {
    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    return {
      ...cliTags,
      ...envVarTags,
    }
  }

  private getCustomMeasures(): Record<string, number> {
    const envVarMetrics = this.config.envVarMetrics ? parseMetrics(this.config.envVarMetrics.split(',')) : {}
    const envVarMeasures = this.config.envVarMeasures ? parseMetrics(this.config.envVarMeasures.split(',')) : {}
    const cliMeasures = this.measures ? parseMetrics(this.measures) : {}

    return {
      ...cliMeasures,
      ...envVarMetrics,
      ...envVarMeasures,
    }
  }

  private getReportTags(): Record<string, string> {
    return this.reportTags ? parseTags(this.reportTags) : {}
  }

  private getReportMeasures(): Record<string, number> {
    const cliMeasures = this.reportMeasures ? parseMetrics(this.reportMeasures) : {}

    return {
      ...cliMeasures,
    }
  }

  private async uploadJUnitXML(api: APIHelper, jUnitXML: Payload) {
    if (this.dryRun) {
      this.logger.info(renderDryRunUpload(jUnitXML))

      return
    }

    try {
      this.logger.info(renderUpload(jUnitXML))
      await retryRequest(() => api.uploadJUnitXML(jUnitXML), {
        onRetry: (e, attempt) => {
          this.context.stderr.write(renderRetriedUpload(jUnitXML, e.message, attempt))
        },
        retries: 5,
      })
    } catch (error) {
      this.context.stderr.write(renderFailedUpload(jUnitXML, error))
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
