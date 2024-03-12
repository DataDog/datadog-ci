import fs from 'fs'
import process from 'process'

import type {AxiosPromise, AxiosResponse} from 'axios'

import Ajv from 'ajv'
import {Command, Option} from 'clipanion'

import {getSpanTags, mandatoryGitFields} from '../../helpers/tags'

import {getApiHelper} from './api'
import {generatePayload} from './payload'
import {
  renderFailedUpload,
  renderInvalidFile,
  renderInvalidPayload,
  renderMissingSpan,
  renderSuccessfulCommand,
  renderUploading,
} from './renderer'
import {ScaRequest} from './types'
import {getValidator, validateSbomFile} from './validation'

export class UploadSbomCommand extends Command {
  public static paths = [['sbom', 'upload']]

  public static usage = Command.Usage({
    category: 'Static Analysis',
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

    const environment: string | undefined = this.env || this.config.env
    this.config.env = environment

    if (!environment) {
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

    // Check if we have all the mandatory git fields
    const spanTagsKeys = Object.keys(tags)
    const filteredSpanTags = spanTagsKeys.filter((key) => mandatoryGitFields[key])
    if (filteredSpanTags.length !== Object.keys(mandatoryGitFields).length) {
      this.context.stdout.write(renderMissingSpan('missing span tags (CI, git, or user-provided tags)'))

      return 1
    }

    const validator: Ajv = getValidator()

    const startTimeMs = Date.now()
    for (const basePath of this.basePaths) {
      if (this.debug) {
        this.context.stdout.write(`Processing file ${basePath}\n`)
      }

      if (!validateSbomFile(basePath, validator, !!this.debug)) {
        this.context.stdout.write(renderInvalidFile(basePath))

        return 1
      }

      const jsonContent = JSON.parse(fs.readFileSync(basePath).toString('utf8'))

      // Upload content
      try {
        const scaPayload = generatePayload(jsonContent, tags, service, environment)
        if (!scaPayload) {
          this.context.stdout.write(renderInvalidPayload(basePath))

          continue
        }

        this.context.stdout.write(renderUploading(basePath))
        await api(scaPayload)
        if (this.debug) {
          this.context.stdout.write(`Upload done for ${basePath}.\n`)
        }
      } catch (error) {
        this.context.stderr.write(renderFailedUpload(basePath, error))

        return 1
      }
    }

    const uploadTimeMs = (Date.now() - startTimeMs) / 1000
    this.context.stdout.write(renderSuccessfulCommand(this.basePaths.length, uploadTimeMs))

    return 0
  }
}
