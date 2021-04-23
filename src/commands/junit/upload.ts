import retry from 'async-retry'
import chalk from 'chalk'
import {Command} from 'clipanion'
import glob from 'glob'
import path from 'path'
import asyncPool from 'tiny-async-pool'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {
  renderCommandInfo,
  renderDryRunUpload,
  renderFailedUpload,
  renderRetriedUpload,
  renderSuccessfulCommand,
} from './renderer'
import {getBaseIntakeUrl, parseTags} from './utils'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git'
import {buildPath} from '../../helpers/utils'

const errorCodesNoRetry = [400, 403, 413]
const errorCodesStopUpload = [400, 403]

export class UploadJUnitXMLCommand extends Command {
  public static usage = Command.Usage({
    description: 'Upload jUnit XML test reports files to Datadog.',
    details: `
            This command will upload to jUnit XML test reports files to Datadog.
            See README for details.
        `,
    examples: [
      ['Upload all jUnit XML test report files in current directory', 'datadog-ci junit upload --service my-service .'],
      [
        'Upload all jUnit XML test report files in src/unit-test-reports and src/acceptance-test-reports',
        'datadog-ci junit upload --service my-service src/unit-test-reports src/acceptance-test-reports',
      ],
      [
        'Upload all jUnit XML test report files in current directory and add extra tags',
        'datadog-ci junit upload --service my-service --tags key1:value1 --tags key2:value2 .',
      ],
    ],
  })

  private basePaths?: string[]
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }
  private dryRun = false
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

    const api = this.getApiHelper()
    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePaths = this.basePaths.map((basePath) => path.posix.normalize(basePath))
    this.context.stdout.write(renderCommandInfo(this.basePaths!, this.service, this.maxConcurrency, this.dryRun))

    const payloads = await this.getMatchingJUnitXMLFiles()
    const upload = (p: Payload) => this.uploadJUnitXML(api, p)

    const initialTime = new Date().getTime()

    await asyncPool(this.maxConcurrency, payloads, upload)

    const totalTimeSeconds = (Date.now() - initialTime) / 1000
    this.context.stdout.write(renderSuccessfulCommand(payloads.length, totalTimeSeconds))
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey)
  }

  private async getMatchingJUnitXMLFiles(): Promise<Payload[]> {
    let jUnitXMLFiles: string[] = []

    this.basePaths?.forEach((basePath) => {
      jUnitXMLFiles = jUnitXMLFiles.concat(glob.sync(buildPath(basePath, '*.xml')))
    })

    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()

    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    const spanTags = {
      ...gitSpanTags,
      ...ciSpanTags,
      ...cliTags,
      ...envVarTags,
      ...(this.config.env ? {env: this.config.env} : {}),
    }

    return jUnitXMLFiles.map((jUnitXMLFilePath) => ({
      service: this.service!,
      spanTags,
      xmlPath: jUnitXMLFilePath,
    }))
  }

  private async uploadJUnitXML(api: APIHelper, jUnitXML: Payload) {
    try {
      await retry(
        async (bail) => {
          try {
            if (this.dryRun) {
              this.context.stdout.write(renderDryRunUpload(jUnitXML))

              return
            }
            await api.uploadJUnitXML(jUnitXML, this.context.stdout.write.bind(this.context.stdout))
          } catch (error) {
            if (error.response) {
              // If it's an axios error
              if (!errorCodesNoRetry.includes(error.response.status)) {
                // And a status code that is not excluded from retries, throw the error so that upload is retried
                throw error
              }
            }
            // If it's another error or an axios error we don't want to retry, bail
            bail(error)

            return
          }
        },
        {
          onRetry: (e, attempt) => {
            this.context.stdout.write(renderRetriedUpload(jUnitXML, e.message, attempt))
          },
          retries: 5,
        }
      )
    } catch (error) {
      this.context.stdout.write(renderFailedUpload(jUnitXML, error))
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
UploadJUnitXMLCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadJUnitXMLCommand.addOption('tags', Command.Array('--tags'))
UploadJUnitXMLCommand.addOption('basePaths', Command.Rest({required: 1}))
