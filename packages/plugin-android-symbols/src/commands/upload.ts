import fs from 'fs'

import type {MultipartPayload} from '@datadog/datadog-ci-base/helpers/upload'

import {AndroidSymbolsUploadCommand} from '@datadog/datadog-ci-base/commands/android-symbols/upload'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSiteFromEnv} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getRepositoryData, newSimpleGit} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {getRepositoryMultipartValue} from '@datadog/datadog-ci-base/helpers/git/repository-payload'
import {upload, UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFileAndEnvironment} from '@datadog/datadog-ci-base/helpers/utils'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {getAndroidSymbolsRequestBuilder} from '../helpers'

export class PluginCommand extends AndroidSymbolsUploadCommand {
  public async execute(): Promise<number> {
    enableFips(
      this.fips || (toBoolean(process.env[FIPS_ENV_VAR]) ?? false),
      this.fipsIgnoreError || (toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false)
    )

    try {
      if (!fs.statSync(this.mappingFile).isFile() || fs.statSync(this.mappingFile).size === 0) {
        throw new Error('The mapping must be a non-empty file.')
      }
      if ((this.buildId !== undefined) === (this.buildIdFile !== undefined)) {
        throw new Error('Provide exactly one of --build-id or --build-id-file, matching the ID packaged in the app.')
      }
      const buildId = (this.buildId ?? fs.readFileSync(this.buildIdFile!, 'utf8')).trim()
      if (!buildId || /\s/.test(buildId) || buildId.length > 200) {
        throw new Error('The build ID must be non-empty, contain no whitespace, and be at most 200 characters.')
      }
      if (!this.service.trim() || !this.version.trim()) {
        throw new Error('--service and --version must be non-empty.')
      }

      const config = await resolveConfigFromFileAndEnvironment(
        {apiKey: '', datadogSite: 'datadoghq.com'},
        {
          apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
          datadogSite: getDatadogSiteFromEnv(),
        },
        {configPath: this.configPath, defaultConfigPaths: DEFAULT_CONFIG_PATHS}
      )

      const metadata: Record<string, string> = {
        type: 'jvm_mapping_file',
        build_id: buildId,
        service: this.service,
        version: this.version,
        variant: this.variant,
        cli_version: cliVersion,
      }
      const payload: MultipartPayload = {
        content: new Map([
          ['jvm_mapping_file', {type: 'file', path: this.mappingFile, options: {filename: 'jvm_mapping'}}],
        ]),
      }
      if (!this.disableGit) {
        try {
          const gitData = await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
          metadata.git_commit_sha = gitData.hash
          metadata.git_repository_url = gitData.remote
          payload.content.set('repository', getRepositoryMultipartValue(gitData))
        } catch {
          this.logger.warn('Could not collect Git metadata. Use --disable-git to skip it.')
        }
      }
      payload.content.set('event', {
        type: 'string',
        value: JSON.stringify(metadata),
        options: {filename: 'event', contentType: 'application/json'},
      })

      if (this.dryRun) {
        this.logger.info(`[DRYRUN] Android mapping ${this.mappingFile}: ${JSON.stringify(metadata)}`)

        return 0
      }
      if (!config.apiKey) {
        throw new Error('Set DATADOG_API_KEY or DD_API_KEY, or provide apiKey in the configuration file.')
      }
      const status = await upload(getAndroidSymbolsRequestBuilder(config.apiKey, cliVersion, config.datadogSite))(
        payload,
        {
          apiKeyValidator: newApiKeyValidator(config),
          retries: 5,
          useGzip: true,
          onUpload: () => this.logger.info(`Uploading Android mapping ${this.mappingFile} (build ID ${buildId})`),
          onRetry: (_error, attempts) => this.logger.warn(`Retrying Android mapping upload (${attempts})`),
          onError: (error) => this.logger.error(`Android mapping upload failed: ${error.message}`),
        }
      )
      if (status !== UploadStatus.Success) {
        return 1
      }
      this.logger.info(`Uploaded Android mapping for build ID ${buildId}`)

      return 0
    } catch (error) {
      this.logger.error(`Android mapping upload failed: ${error instanceof Error ? error.message : String(error)}`)

      return 1
    }
  }
}
