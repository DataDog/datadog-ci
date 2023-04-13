import fs from 'fs'
import os from 'os'
import path from 'path'

import chalk from 'chalk'
import {Command} from 'clipanion'
import {XMLParser, XMLValidator} from 'fast-xml-parser'
import glob from 'glob'
import asyncPool from 'tiny-async-pool'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {MetricsLogger, getMetricsLogger} from '../../helpers/metrics'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath} from '../../helpers/utils'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

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
  public static usage = Command.Usage({
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
        'Upload all jUnit XML test report files in current directory to the datadoghq.eu site',
        'DATADOG_SITE=datadoghq.eu datadog-ci junit upload --service my-service .',
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
    ],
  })

  private basePaths?: string[]
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }
  private dryRun = false
  private env?: string
  private logs = false
  private maxConcurrency = 20
  private service?: string
  private tags?: string[]
  private rawXPathTags?: string[]
  private xpathTags?: Record<string, string>
  private cliVersion: string

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
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

    const metricsLogger = getMetricsLogger({
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [`cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.junit.',
    })

    if (
      !this.logs &&
      process.env.DD_CIVISIBILITY_LOGS_ENABLED &&
      !['false', '0'].includes(process.env.DD_CIVISIBILITY_LOGS_ENABLED.toLowerCase())
    ) {
      this.logs = true
      metricsLogger.logger.increment('logs.enabled', 1)
    }

    if (this.rawXPathTags) {
      this.xpathTags = this.parseXPathTags(this.rawXPathTags)
      if (Object.keys(this.xpathTags).length !== this.rawXPathTags.length) {
        return 1
      }
      metricsLogger.logger.increment('xpath_tags.enabled', 1)
    }

    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    const api = apiConstructor(getBaseIntakeUrl(), this.config.apiKey)

    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
    this.context.stdout.write(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

    const spanTags = await this.getSpanTags()
    const payloads = await this.getMatchingJUnitXMLFiles(spanTags)
    const upload = (p: Payload) => this.uploadJUnitXML(api, p, metricsLogger)

    const initialTime = new Date().getTime()

    await asyncPool(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(
      renderSuccessfulCommand(payloads.length, totalTimeSeconds, spanTags, this.service, this.config.env)
    )

    metricsLogger.logger.increment('success', 1)
    try {
      await metricsLogger.flush()
    } catch (err) {
      this.logger.warn(`WARN: ${err}`)
    }
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

  private async getMatchingJUnitXMLFiles(spanTags: SpanTags): Promise<Payload[]> {
    const jUnitXMLFiles = (this.basePaths || []).reduce((acc: string[], basePath: string) => {
      const isFile = !!path.extname(basePath)
      if (isFile) {
        return acc.concat(fs.existsSync(basePath) ? [basePath] : [])
      }

      return acc.concat(glob.sync(buildPath(basePath, '*.xml')))
    }, [])

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
      service: this.service!,
      spanTags,
      xmlPath: jUnitXMLFilePath,
    }))
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

  private async uploadJUnitXML(api: APIHelper, jUnitXML: Payload, metricsLogger: MetricsLogger) {
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunUpload(jUnitXML))

      return
    }

    try {
      await retryRequest(() => api.uploadJUnitXML(jUnitXML, this.context.stdout.write.bind(this.context.stdout)), {
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
      metricsLogger.logger.increment('failed', 1)
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.logger.warn(`WARN: ${err}`)
      }
      throw error
    }
  }
}
UploadJUnitXMLCommand.addPath('junit', 'upload')
UploadJUnitXMLCommand.addOption('service', Command.String('--service'))
UploadJUnitXMLCommand.addOption('env', Command.String('--env'))
UploadJUnitXMLCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadJUnitXMLCommand.addOption('tags', Command.Array('--tags'))
UploadJUnitXMLCommand.addOption('basePaths', Command.Rest({required: 1}))
UploadJUnitXMLCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadJUnitXMLCommand.addOption('logs', Command.Boolean('--logs'))
UploadJUnitXMLCommand.addOption('rawXPathTags', Command.Array('--xpath-tag'))
