import fs from 'fs'
import process from 'process'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {
  GIT_SHA,
  GIT_REPOSITORY_URL,
  getSpanTags,
  getMissingRequiredGitTags,
  GIT_BRANCH,
} from '@datadog/datadog-ci-base/helpers/tags'
import Ajv from 'ajv'
import {AxiosPromise, AxiosResponse, isAxiosError} from 'axios'
import {Command, Option} from 'clipanion'

import {renderMissingTags} from '../sarif/renderer'

import {getApiHelper} from './api'
import {generatePayload} from './payload'
import {
  renderDuplicateUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderInvalidPayload,
  renderNoDefaultBranch,
  renderPayloadWarning,
  renderSuccessfulCommand,
  renderUploading,
} from './renderer'
import {ScaRequest} from './types'
import {
  filterInvalidDependencies,
  getValidator,
  validateFileAgainstToolRequirements,
  validateSbomFileAgainstSchema,
} from './validation'

export class UploadSbomCommand extends Command {
  public static paths = [['sbom', 'upload']]

  public static usage = Command.Usage({
    category: 'Static Analysis',
    description: 'Upload SBOM files to Datadog.',
    details: `
      This command uploads SBOM files to Datadog for dependency tracking.
    `,
    examples: [['Upload the SBOM file sbom.json', 'datadog-ci sbom upload file.sbom']],
  })

  private basePath = Option.String()
  private serviceFromCli = Option.String('--service')
  private env = Option.String('--env', 'ci')
  private tags = Option.Array('--tags')
  private gitPath = Option.String('--git-repository')
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

    // TODO(julien): remove this notice in April 2025
    if (this.serviceFromCli !== undefined) {
      this.context.stderr.write(
        'The CLI flag `--service` is deprecated and will be removed in a future version of datadog-ci\n'
      )
      this.context.stderr.write(
        'To associate findings with services, consider using the service-to-repo mapping from service catalog\n'
      )
      this.context.stderr.write(
        'Learn more at https://docs.datadoghq.com/getting_started/code_security/?tab=staticcodeanalysissast#link-datadog-services-to-repository-scan-results\n'
      )
    }

    const service = 'datadog-ci'

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

    const tags = await getSpanTags(this.config, this.tags, !this.noCiTags, this.gitPath)

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
        'SBOM file not fully compliant against CycloneDX 1.4, 1.5 or 1.6 specifications (use --debug to get validation error)\n'
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

      this.context.stdout.write(renderPayloadWarning(scaPayload.dependencies))

      scaPayload.dependencies = filterInvalidDependencies(scaPayload.dependencies)

      this.context.stdout.write(renderUploading(basePath, scaPayload))

      await api(scaPayload)
      if (this.debug) {
        this.context.stdout.write(`Upload done for ${basePath}.\n`)
      }
    } catch (error) {
      if (isAxiosError(error)) {
        if (error.response?.status === 409) {
          const sha = tags[GIT_SHA] || 'sha-not-found'
          const branch = tags[GIT_BRANCH] || 'branch-not-found'
          this.context.stderr.write(renderDuplicateUpload(branch, sha))

          return 0
        }

        if (error.response?.status === 412) {
          const repositoryUrl = tags[GIT_REPOSITORY_URL] || 'repo-url-not-found'
          this.context.stderr.write(renderNoDefaultBranch(repositoryUrl))

          return 1
        }
      }

      this.context.stderr.write(renderFailedUpload(basePath, error, !!this.debug))

      return 1
    }

    const uploadTimeMs = (Date.now() - startTimeMs) / 1000
    this.context.stdout.write(renderSuccessfulCommand(uploadTimeMs))

    return 0
  }
}
