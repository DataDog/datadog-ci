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
import {getBaseIntakeUrl} from './utils'

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
        `,
    examples: [
      ['Upload all jUnit XML test report files in current directory', 'datadog-ci junit upload . --service my-service'],
    ],
  })

  private basePath?: string
  private config = {
    apiKey: process.env.DATADOG_API_KEY,
  }
  private dryRun = false
  private maxConcurrency = 20
  private service?: string

  public async execute() {
    if (!this.service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }
    if (!this.basePath) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    const api = this.getApiHelper()
    // Normalizing the basePath to resolve .. and .
    // Always using the posix version to avoid \ on Windows.
    this.basePath = path.posix.normalize(this.basePath)
    this.context.stdout.write(renderCommandInfo(this.basePath!, this.service, this.maxConcurrency, this.dryRun))

    const payloads = this.getMatchingJUnitXMLFiles()
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

  private getMatchingJUnitXMLFiles(): Payload[] {
    const jUnitXMLFiles = glob.sync(buildPath(this.basePath!, '**/*.xml'))

    const ciSpanTags = getCISpanTags()
    const gitSpanTags = getGitMetadata()

    const spanTags = {
      ...gitSpanTags,
      ...ciSpanTags,
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
UploadJUnitXMLCommand.addOption('basePath', Command.String({required: true}))
UploadJUnitXMLCommand.addOption('service', Command.String('--service'))
UploadJUnitXMLCommand.addOption('dryRun', Command.Boolean('--dry-run'))
