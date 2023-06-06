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
import {RequestBuilder} from '../../helpers/interfaces'
import {Logger, LogLevel} from '../../helpers/logger'
import {getMetricsLogger} from '../../helpers/metrics'
import {retryRequest} from '../../helpers/retry'
import {parseTags, parseMetrics} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'
import {buildPath, getRequestBuilder, timedExecAsync} from '../../helpers/utils'

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
} from './renderer'

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
        'Upload all jUnit XML test report files in current directory and add extra metrics globally',
        'datadog-ci junit upload --service my-service --metrics key1:123 --metrics key2:321 .',
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
      [
        'Upload all jUnit XML test report files in current directory with extra verbosity',
        'datadog-ci junit upload --verbose --service my-service .',
      ],
    ],
  })

  private basePaths?: string[]
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    envVarMetrics: process.env.DD_METRICS,
  }
  private verbose = false
  private dryRun = false
  private env?: string
  private logs = false
  private maxConcurrency = 20
  private metrics?: string[]
  private service?: string
  private tags?: string[]
  private rawXPathTags?: string[]
  private xpathTags?: Record<string, string>
  private gitRepositoryURL?: string
  private skipGitMetadataUpload?: boolean
  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)
  private cliVersion: string

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
  }


  public async execute() {
    this.logger.setLogLevel(this.verbose ? LogLevel.DEBUG : LogLevel.INFO)
    this.logger.setShouldIncludeTime(this.verbose)
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

    if (
      !this.logs &&
      process.env.DD_CIVISIBILITY_LOGS_ENABLED &&
      !['false', '0'].includes(process.env.DD_CIVISIBILITY_LOGS_ENABLED.toLowerCase())
    ) {
      this.logs = true
    }

    if (this.rawXPathTags) {
      this.xpathTags = this.parseXPathTags(this.rawXPathTags)
      if (Object.keys(this.xpathTags).length !== this.rawXPathTags.length) {
        return 1
      }
    }

    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: process.env.DATADOG_SITE,
      defaultTags: [`service:${this.service}`, `cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.junit.upload.',
    })

    const api = this.getApiHelper()

    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
    this.logger.info(renderCommandInfo(this.basePaths, this.service, this.maxConcurrency, this.dryRun))

    const spanTags = await this.getSpanTags()
    const payloads = await this.getMatchingJUnitXMLFiles(spanTags)
    const upload = (p: Payload) => this.uploadJUnitXML(api, p)

    const initialTime = new Date().getTime()

    await asyncPool(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.logger.info(renderSuccessfulUpload(this.dryRun, payloads.length, totalTimeSeconds))

    metricsLogger.logger.gauge('junit.xml.upload.duration', totalTimeSeconds)

    if (!this.skipGitMetadataUpload) {
      if (await isGitRepo()) {
        const requestBuilder = getRequestBuilder({baseUrl: apiUrl, apiKey: this.config.apiKey!})
        try {
          this.logger.info(`${this.dryRun ? '[DRYRUN] ' : ''}Syncing git metadata...`)
          let elapsed = 0
          if (!this.dryRun) {
            elapsed = await timedExecAsync(this.uploadToGitDB.bind(this), {requestBuilder})
          }
          this.logger.info(renderSuccessfulGitDBSync(this.dryRun, elapsed))
          metricsLogger.logger.gauge('junit.git.upload.duration', elapsed)
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
    await metricsLogger.flush()
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
    const envVarMetrics = this.config.envVarMetrics ? parseMetrics(this.config.envVarMetrics.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}
    const cliMetrics = this.metrics ? parseMetrics(this.metrics) : {}

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...cliTags,
      ...envVarTags,
      ...cliMetrics,
      ...envVarMetrics,
      ...(this.config.env ? {env: this.config.env} : {}),
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
UploadJUnitXMLCommand.addPath('junit', 'upload')
UploadJUnitXMLCommand.addOption('service', Command.String('--service'))
UploadJUnitXMLCommand.addOption('env', Command.String('--env'))
UploadJUnitXMLCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadJUnitXMLCommand.addOption('tags', Command.Array('--tags'))
UploadJUnitXMLCommand.addOption('metrics', Command.Array('--metrics'))
UploadJUnitXMLCommand.addOption('basePaths', Command.Rest({required: 1}))
UploadJUnitXMLCommand.addOption('maxConcurrency', Command.String('--max-concurrency'))
UploadJUnitXMLCommand.addOption('logs', Command.Boolean('--logs'))
UploadJUnitXMLCommand.addOption('rawXPathTags', Command.Array('--xpath-tag'))
UploadJUnitXMLCommand.addOption('skipGitMetadataUpload', Command.Boolean('--skip-git-metadata-upload'))
UploadJUnitXMLCommand.addOption('gitRepositoryURL', Command.String('--git-repository-url'))
UploadJUnitXMLCommand.addOption('verbose', Command.Boolean('--verbose'))
