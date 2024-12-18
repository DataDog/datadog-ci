import fs from 'fs'
import process from 'process'

import Ajv from 'ajv'
import {AxiosPromise, AxiosResponse, isAxiosError} from 'axios'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {GIT_SHA, GIT_REPOSITORY_URL, getSpanTags, getMissingRequiredGitTags} from '../../helpers/tags'

import {renderMissingTags} from '../sarif/renderer'

import {getApiHelper} from './api'
import {generatePayload} from './payload'
import {
  renderDuplicateUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderInvalidPayload,
  renderNoDefaultBranch,
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
    fips: process.env[FIPS_ENV_VAR],
  }

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  /**
   * Execute the command, which means parse the SBOM file, ensure they are
   * compliant with their schema and upload them to datadog.
   */
  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

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

    // Gather any missing mandatory git fields to display to the user
    const missingGitFields = getMissingRequiredGitTags(tags)
    if (missingGitFields.length > 0) {
      this.context.stdout.write(renderMissingTags(missingGitFields))

      return 1
    }

    const validator: Ajv = getValidator()

    const startTimeMs = Date.now()
    const basePath = this.basePath

    if (this.debug) {
      this.context.stdout.write(`Processing file ${basePath}\n`)
    }

    if (!validateSbomFileAgainstSchema(basePath, validator, !!this.debug)) {
      this.context.stdout.write(
        'SBOM file not fully compliant against CycloneDX 1.4 or 1.5 specifications (use --debug to get validation error)\n'
      )
    }
    if (!validateFileAgainstToolRequirements(basePath, !!this.debug)) {
      this.context.stdout.write(renderInvalidFile(basePath))

      return 1
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

        if (error.response?.status === 412) {
          const repositoryUrl = tags[GIT_REPOSITORY_URL] || 'url-not-found'
          this.context.stderr.write(renderNoDefaultBranch(repositoryUrl))

          return 1
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
