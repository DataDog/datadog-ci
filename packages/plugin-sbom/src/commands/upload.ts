import fs from 'fs'
import process from 'process'

import {SbomUploadCommand} from '@datadog/datadog-ci-base/commands/sbom/upload'
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

import {getApiHelper} from '../api'
import {generatePayload} from '../payload'
import {
  renderDuplicateUpload,
  renderFailedUpload,
  renderInvalidFile,
  renderInvalidPayload,
  renderMissingTags,
  renderNoDefaultBranch,
  renderPayloadWarning,
  renderSuccessfulCommand,
  renderUploading,
} from '../renderer'
import {ScaRequest} from '../types'
import {
  filterInvalidDependencies,
  getValidator,
  validateFileAgainstToolRequirements,
  validateSbomFileAgainstSchema,
} from '../validation'

export class PluginCommand extends SbomUploadCommand {
  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY || '',
    env: process.env.DD_ENV,
    envVarTags: process.env.DD_TAGS,
    fips: process.env[FIPS_ENV_VAR],
  }

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

    const githubEvent = process.env.GITHUB_EVENT_NAME
    const gitlabEvent = process.env.CI_PIPELINE_SOURCE
    const azureReason = process.env.BUILD_REASON

    if (githubEvent === 'pull_request') {
      // https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#example-setting-an-error-message
      this.context.stdout.write(
        '::error title=Unsupported Trigger::The `pull_request` event is not supported by Datadog Code Security and will cause issues with the product. ' +
          'To continue using Datadog Code Security, use `push` instead. See: https://docs.datadoghq.com/security/code_security/software_composition_analysis/setup_static/?tab=github#run-via-pipelines-integration for more information.'
      )

      return 1
    }

    if (gitlabEvent === 'merge_request_event') {
      this.context.stderr.write(
        'The `merge_request_event` pipeline source is not supported by Datadog Code Security and will cause issues with the product. ' +
          'To continue using Datadog Code Security, use `push` instead. See: https://docs.datadoghq.com/security/code_security/software_composition_analysis/setup_static/?tab=github#run-via-pipelines-integration for more information.'
      )

      return 1
    }

    if (azureReason === 'PullRequest') {
      // https://learn.microsoft.com/en-us/azure/devops/pipelines/scripts/logging-commands?view=azure-devops&tabs=bash#logging-commands-for-build-pipelines
      this.context.stdout.write(
        '##vso[task.logissue type=error]The `PullRequest` build reason is not supported by Datadog Code Security and will cause issues with the product. ' +
          'To continue using Datadog Code Security, use `push` instead. See: https://docs.datadoghq.com/security/code_security/software_composition_analysis/setup_static/?tab=github#run-via-pipelines-integration for more information.'
      )

      return 1
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
