import fs from 'fs'
import os from 'os'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {XMLParser, XMLValidator} from 'fast-xml-parser'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'
import * as t from 'typanion'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
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
import id from './id'
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
  if (!xmlFileJSON.testsuites && !xmlFileJSON.testsuite) {
    return 'Neither <testsuites> nor <testsuite> are the root tag.'
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
        'Upload all jUnit XML test report files in current directory and add extra metrics globally',
        'datadog-ci junit upload --service my-service --metrics key1:123 --metrics key2:321 .',
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
  private metrics = Option.Array('--metrics')
  private service = Option.String('--service', {env: 'DD_SERVICE'})
  private tags = Option.Array('--tags')
  private reportTags = Option.Array('--report-tags')
  private reportMetrics = Option.Array('--report-metrics')
  private rawXPathTags = Option.Array('--xpath-tag')
  private gitRepositoryURL = Option.String('--git-repository-url')
  private skipGitMetadataUpload = Option.String('--skip-git-metadata-upload', 'true', {validator: t.isBoolean()})

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMetrics: process.env.DD_METRICS,
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
    const customMetrics = this.getCustomMetrics()
    const reportTags = this.getReportTags()
    const reportMetrics = this.getReportMetrics()
    const payloads = await this.getMatchingJUnitXMLFiles(spanTags, customTags, customMetrics, reportTags, reportMetrics)
    const upload = (p: Payload) => this.uploadJUnitXML(api, p)

    const initialTime = new Date().getTime()

    await asyncPool(this.maxConcurrency, payloads, upload)

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
    customMetrics: Record<string, number>,
    reportTags: Record<string, string>,
    reportMetrics: Record<string, number>
  ): Promise<Payload[]> {
    const jUnitXMLFiles = (this.basePaths || [])
      .reduce((acc: string[], basePath: string) => {
        if (isFile(basePath)) {
          return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
        }

        return acc.concat(glob.sync(buildPath(basePath, '*.xml')))
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
      customMetrics,
      reportTags,
      reportMetrics,
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

  private getCustomMetrics(): Record<string, number> {
    const envVarMetrics = this.config.envVarMetrics ? parseMetrics(this.config.envVarMetrics.split(',')) : {}
    const cliMetrics = this.metrics ? parseMetrics(this.metrics) : {}

    return {
      ...cliMetrics,
      ...envVarMetrics,
    }
  }

  private getReportTags(): Record<string, string> {
    return this.reportTags ? parseTags(this.reportTags) : {}
  }

  private getReportMetrics(): Record<string, number> {
    return this.reportMetrics ? parseMetrics(this.reportMetrics) : {}
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
