import fs from 'fs'
import process from 'process'

import Ajv from 'ajv'
import {AxiosPromise, AxiosResponse} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {getSpanTags} from '../../helpers/tags'

import {getApiHelper} from './api'
import {generatePayload} from './payload'
import {ScaRequest} from './types'
import {getValidator, validateSbomFile} from './validation'

export class UploadSbomCommand extends Command {
  public static paths = [['sbom', 'upload']]

  public static usage = Command.Usage({
    description: 'Upload SBOM files to Datadog.',
    details: `
      This command uploads SBOM files to Datadog for dependency tracking.
    `,
    examples: [['Upload the SBOM file sbom.json', 'datadog-ci sbom upload --service my-service file.sbom']],
  })

  private basePaths = Option.Rest({required: 1})
  private service = Option.String('--service')
  private env = Option.String('--env')
  private tags = Option.Array('--tags')
  private debug = Option.Boolean('--debug')

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY || '',
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
  }

  /**
   * Execute the command, which means parse the SBOM file, ensure they are
   * compliant with their schema and upload them to datadog.
   */
  public async execute() {
    const service: string | undefined = this.service || process.env.DD_SERVICE

    if (!service) {
      this.context.stderr.write('Missing service\n')

      return 1
    }

    this.config.env = this.env || this.config.env

    if (!this.config.env) {
      this.context.stderr.write('Missing env\n')

      return 1
    }

    if (!this.basePaths || !this.basePaths.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    if (!this.config.apiKey) {
      this.context.stderr.write('API key not defined\n')

      return 1
    }

    // Get the API helper to send the payload
    const api: (sbomPayload: ScaRequest) => AxiosPromise<AxiosResponse> = getApiHelper(
      this.config.apiKey,
      this.config.appKey
    )

    const tags = await getSpanTags(this.config, this.tags)

    const validator: Ajv = getValidator()
    for (const basePath of this.basePaths) {
      if (this.debug) {
        this.context.stdout.write(`Processing file ${basePath}\n`)
      }

      if (validateSbomFile(basePath, validator, !!this.debug)) {
        const filePath = basePath
        const jsonContent = JSON.parse(fs.readFileSync(basePath).toString('utf8'))

        // Upload content
        try {
          const scaPayload = generatePayload(jsonContent, tags)

          if (!scaPayload) {
            console.log(`Cannot generate payload for file ${filePath}`)
            continue
          }

          const startTimeMs = Date.now()
          const response = await api(scaPayload)
          const endTimeMs = Date.now()
          if (this.debug) {
            this.context.stdout.write(`Upload done, status: ${response.status}\n`)
          }
          const apiTimeMs = endTimeMs - startTimeMs
          this.context.stdout.write(`File ${basePath} successfully uploaded in ${apiTimeMs} ms\n`)
        } catch (error) {
          process.stderr.write(`Error while writing the payload: ${error.message}\n`)
          if (error.response) {
            process.stderr.write(`API status: ${error.response.status}\n`)
          }
        }
      } else {
        this.context.stdout.write(`File ${chalk.red.bold(basePath)} is not a valid SBOM file.\n`)
      }
    }

    this.context.stdout.write('Upload finished\n')

    return 0
  }
}
