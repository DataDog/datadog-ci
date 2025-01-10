import fs from 'fs'
import os from 'os'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {XMLParser, XMLValidator} from 'fast-xml-parser'
import glob from 'glob'
import * as t from 'typanion'

import {getCISpanTags} from '../../helpers/ci'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import id from '../../helpers/id'
import {SpanTags, RequestBuilder} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {retryRequest} from '../../helpers/retry'
import {parseTags, parseMetrics} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath, getRequestBuilder, timedExecAsync} from '../../helpers/utils'
import * as validation from '../../helpers/validation'

import {newSimpleGit} from '../git-metadata/git'
import {uploadToGitDB} from '../git-metadata/gitdb'
import {isGitRepo} from '../git-metadata/library'

import {apiConstructor, apiUrl, intakeUrl} from './api'
import {APIHelper, Payload} from './interfaces'
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
  renderDeprecatedMention,
} from './renderer'
import {isFile} from './utils'

const TRACE_ID_HTTP_HEADER = 'x-datadog-trace-id'
const PARENT_ID_HTTP_HEADER = 'x-datadog-parent-id'
const errorCodesStopUpload = [400, 403]

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

export class UploadJUnitXMLCommand extends Command {
  public static paths = [['junit', 'upload']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Upload jUnit XML test reports files to Datadog.',
    details: `
      This command will upload to jUnit XML test reports files to Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all jUnit XML test report files in current directory', 'datadog-ci junit upload --service my-service .'],
      [
        'Upload all jUnit XML test report files in src/unit-test-reports and src/acceptance-test-reports',
        'datadog-ci junit upload --service my-service src/unit-test-reports src/acceptance-test-reports',
      ],
      [
        'Upload all jUnit XML test report files in current directory and add extra tags globally',
        'datadog-ci junit upload --service my-service --tags key1:value1 --tags key2:value2 .',
      ],
      [
        'Upload all jUnit XML test report files in current directory and add extra measures globally',
        'datadog-ci junit upload --service my-service --measures key1:123 --measures key2:321 .',
      ],
      [
        'Upload all jUnit XML test report files in current directory to the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci junit upload --service my-service .',
      ],
      [
        'Upload all jUnit XML test report files in current directory while also collecting logs',
        'datadog-ci junit upload --service my-service --logs .',
      ],
      [
        'Upload all jUnit XML test report files in current directory customizing test suite with xpath',
        'datadog-ci junit upload --service my-service --xpath-tag test.suite=/testcase/@classname .',
      ],
      [
        'Upload all jUnit XML test report files in current directory adding a custom tag from property with xpath',
        "datadog-ci junit upload --service my-service --xpath-tag custom_tag=/testcase/..//property[@name='property-name'] .",
      ],
      [
        'Upload all jUnit XML test report files in current directory with extra verbosity',
        'datadog-ci junit upload --verbose --service my-service .',
      ],
    ],
  })

  private basePaths = Option.Rest({required: 1})
  private verbose = Option.Boolean('--verbose', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private env = Option.String('--env')
  private logs = Option.String('--logs', 'false', {
    env: 'DD_CIVISIBILITY_LOGS_ENABLED',
    tolerateBoolean: true,
    validator: t.isBoolean(),
  })
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private metrics = Option.Array('--metrics', {hidden: true})
  private measures = Option.Array('--measures')
  private service = Option.String('--service', {env: 'DD_SERVICE'})
  private tags = Option.Array('--tags')
  private reportTags = Option.Array('--report-tags')
  private reportMetrics = Option.Array('--report-metrics', {hidden: true})
  private reportMeasures = Option.Array('--report-measures')
  private rawXPathTags = Option.Array('--xpath-tag')
  private gitRepositoryURL = Option.String('--git-repository-url')
  private skipGitMetadataUpload = Option.String('--skip-git-metadata-upload', 'false', {
    validator: t.isBoolean(),
    tolerateBoolean: true,
  })

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMetrics: process.env.DD_METRICS,
    envVarMeasures: process.env.DD_MEASURES,
  }

  private xpathTags?: Record<string, string>
  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)

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

    if (this.rawXPathTags) {
      this.xpathTags = this.parseXPathTags(this.rawXPathTags)
      if (Object.keys(this.xpathTags).length !== this.rawXPathTags.length) {
        return 1
      }
    }

    const api = this.getApiHelper()

    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
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
    const jUnitXMLFiles = (this.basePaths || [])
      .reduce((acc: string[], basePath: string) => {
        if (isFile(basePath)) {
          return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
        }
        let globPattern
        // It's either a folder (possibly including .xml extension) or a glob pattern
        if (glob.hasMagic(basePath)) {
          // It's a glob pattern so we just use it as is
          globPattern = basePath
        } else {
          // It's a folder
          globPattern = buildPath(basePath, '*.xml')
        }

        const filesToUpload = glob.sync(globPattern).filter((file) => path.extname(file) === '.xml')

        return acc.concat(filesToUpload)
      }, [])
      .filter(isFile)

    const validUniqueFiles = [...new Set(jUnitXMLFiles)].filter((jUnitXMLFilePath) => {
      const validationErrorMessage = validateXml(jUnitXMLFilePath)
      if (validationErrorMessage) {
        this.context.stdout.write(renderInvalidFile(jUnitXMLFilePath, validationErrorMessage))

        return false
      }

      return true
    })

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
    const cliMetrics = this.metrics ? parseMetrics(this.metrics) : {}
    const cliMeasures = this.measures ? parseMetrics(this.measures) : {}

    // We have renamed "metrics" to "measures", but we will still support the old names for now.
    if (this.metrics) {
      this.context.stdout.write(renderDeprecatedMention('--metrics', '--measures', 'option'))
    }
    if (this.config.envVarMetrics) {
      this.context.stdout.write(renderDeprecatedMention('DD_METRICS', 'DD_MEASURES', 'environment variable'))
    }

    return {
      ...cliMetrics,
      ...cliMeasures,
      ...envVarMetrics,
      ...envVarMeasures,
    }
  }

  private getReportTags(): Record<string, string> {
    return this.reportTags ? parseTags(this.reportTags) : {}
  }

  private getReportMeasures(): Record<string, number> {
    const cliMetrics = this.reportMetrics ? parseMetrics(this.reportMetrics) : {}
    const cliMeasures = this.reportMeasures ? parseMetrics(this.reportMeasures) : {}

    // We have renamed "metrics" to "measures", but we will still support the old names for now.
    if (this.reportMetrics) {
      this.context.stdout.write(renderDeprecatedMention('--report-metrics', '--report-measures', 'option'))
    }

    return {
      ...cliMetrics,
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
