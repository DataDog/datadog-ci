import fs from 'fs'
import process from 'process'

import Ajv from 'ajv'
import {AxiosPromise, AxiosResponse, isAxiosError} from 'axios'
import {Command, Option} from 'clipanion'

import {GIT_SHA, getSpanTags, mandatoryGitFields} from '../../helpers/tags'

import {getApiHelper} from './api'
import {generatePayload} from './payload'
import {
  renderDuplicateUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderInvalidPayload,
  renderMissingSpan,
  renderSuccessfulCommand,
  renderUploading,
} from './renderer'
import {ScaRequest} from './types'
import {getValidator, validateFileAgainstToolRequirements, validateSbomFileAgainstSchema} from './validation'

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

  private basePath = Option.String()
  private service = Option.String('--service', 'datadog-ci')
  private env = Option.String('--env', 'ci')
  private tags = Option.Array('--tags')
  private debug = Option.Boolean('--debug')
  private noCiTags = Option.Boolean('--no-ci-tags', false)

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
    const service: string = this.service

    const environment = this.env

    if (!this.basePath || !this.basePath.length) {
      this.context.stderr.write('Missing basePath\n')

      return 1
    }

    if (!this.config.apiKey) {
      this.context.stderr.write('API key not defined, define the environment variable DD_API_KEY.\n')

      return 1
    }

    if (!this.config.appKey) {
      this.context.stderr.write('APP key not defined, define the environment variable DD_APP_KEY.\n')

      return 1
    }

    // Get the API helper to send the payload
    const api: (sbomPayload: ScaRequest) => AxiosPromise<AxiosResponse> = getApiHelper(
      this.config.apiKey,
      this.config.appKey
    )

    const tags = await getSpanTags(this.config, this.tags, !this.noCiTags)

    // Check if we have all the mandatory git fields
    const spanTagsKeys = Object.keys(tags)
    const filteredSpanTags = spanTagsKeys.filter((key) => mandatoryGitFields[key])
    if (filteredSpanTags.length !== Object.keys(mandatoryGitFields).length) {
      this.context.stdout.write(renderMissingSpan('missing span tags (CI, git, or user-provided tags)'))

      return 1
    }

    const validator: Ajv = getValidator()

    const startTimeMs = Date.now()
    const basePath = this.basePath

    if (this.debug) {
      this.context.stdout.write(`Processing file ${basePath}\n`)
    }

    if (!validateSbomFileAgainstSchema(basePath, validator, !!this.debug)) {
      if (!validateFileAgainstToolRequirements(basePath, !!this.debug)) {
        this.context.stdout.write(renderInvalidFile(basePath))

        return 1
      } else {
        this.context.stdout.write(
          'Invalid SBOM file but enough data to be processed (use --debug to get validation error)\n'
        )
      }
    }

    const jsonContent = JSON.parse(fs.readFileSync(basePath).toString('utf8'))

    // Upload content
    try {
      const scaPayload = generatePayload(jsonContent, tags, service, environment)
      if (!scaPayload) {
        this.context.stdout.write(renderInvalidPayload(basePath))

        return 1
      }
      this.context.stdout.write(renderUploading(basePath))
      await api(scaPayload)
      if (this.debug) {
        this.context.stdout.write(`Upload done for ${basePath}.\n`)
      }
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 409) {
          const sha = tags[GIT_SHA] || 'sha-not-found'
          this.context.stderr.write(renderDuplicateUpload(sha, environment, service))

          return 0
        }
      }

      this.context.stderr.write(renderFailedUpload(basePath, error))

      return 1
    }

    const uploadTimeMs = (Date.now() - startTimeMs) / 1000
    this.context.stdout.write(renderSuccessfulCommand(uploadTimeMs))

    return 0
  }
}
