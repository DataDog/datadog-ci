import fs from 'fs'

import type {JvmMappingMetadata} from './interfaces'
import type {RepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import type {MultipartValue} from '@datadog/datadog-ci-base/helpers/upload'

import {Command, Option} from 'clipanion'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSiteFromEnv} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getRepositoryData, newSimpleGit} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {getRepositoryMultipartValue} from '@datadog/datadog-ci-base/helpers/git/repository-payload'
import {getMetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import {UploadStatus} from '@datadog/datadog-ci-base/helpers/upload'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFileAndEnvironment} from '@datadog/datadog-ci-base/helpers/utils'
import {checkAPIKeyOverride} from '@datadog/datadog-ci-base/helpers/validation'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {apiKeyAuth} from '../../helpers/auth'

import {getJvmMappingSymbolsRequestBuilder, uploadMultipartHelper} from './helpers'
import {JVM_MAPPING_FILE_NAME, TYPE_JVM_MAPPING, VALUE_NAME_JVM_MAPPING} from './interfaces'
import {
  renderArgumentMissingError,
  renderBuildIdFileTooLarge,
  renderBuildIdOptionsError,
  renderBuildIdWithByteOrderMark,
  renderCommandInfo,
  renderCommandSummary,
  renderEventPayload,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidBuildId,
  renderInvalidMappingFile,
  renderRetriedUpload,
  renderUnreadableBuildIdFile,
  renderUpload,
} from './renderer'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A build ID file holds a single UUID: anything much bigger is the wrong file.
const MAX_BUILD_ID_FILE_SIZE = 1024
const BYTE_ORDER_MARK = '\uFEFF'

export class JvmMappingSymbolsUploadCommand extends BaseCommand {
  public static paths = [['jvm-mapping-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload a JVM (R8 or ProGuard) mapping file to Datadog, keyed by a build ID.',
    details: `
      This command uploads the R8 or ProGuard mapping file of a build, under the build ID the app ships, so that
      the Java and Kotlin frames of its errors can be deobfuscated. It's meant for apps that aren't built with the
      Datadog Android Gradle plugin, such as .NET MAUI apps.
    `,
    examples: [
      [
        'Upload a mapping file with the build ID file the app ships',
        'datadog-ci jvm-mapping-symbols upload ./mapping.txt --build-id-file ./datadog.buildId --service-name com.example.app --version 1.0.0',
      ],
    ],
  })

  public static authRequirement = apiKeyAuth

  private mappingFile = Option.String({required: false, name: 'mapping-file'})
  private buildId = Option.String('--build-id', {
    description: 'The build ID of the app, as shipped in its assets/datadog.buildId file: a UUID.',
  })
  private buildIdFile = Option.String('--build-id-file', {
    description: 'A file holding the build ID of the app, for example the datadog.buildId file it ships.',
  })
  private serviceName = Option.String('--service-name', {description: 'Required. The service name of the app.'})
  private version = Option.String('--version', {description: 'Required. The version of the app.'})
  private variant = Option.String('--variant', '', {description: 'The variant (flavor) of the app. Defaults to none.'})
  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private repositoryUrl = Option.String('--repository-url')

  private cliVersion = cliVersion
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private gitData?: RepositoryData
  private gitRepositoryPayload?: MultipartValue
  private resolvedBuildId?: string

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    if (!this.verifyParameters()) {
      return 1
    }

    const initialTime = Date.now()

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.mappingFile!, this.resolvedBuildId!))

    this.config = await resolveConfigFromFileAndEnvironment(
      this.config,
      {
        apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
        datadogSite: getDatadogSiteFromEnv(),
      },
      {
        configPath: this.configPath,
        defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        configFromFileCallback: (configFromFile: any) => {
          checkAPIKeyOverride(
            process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
            configFromFile.apiKey,
            this.context.stdout
          )
        },
      }
    )

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
      if (this.gitData !== undefined) {
        this.gitRepositoryPayload = getRepositoryMultipartValue(this.gitData)
      }
    }

    try {
      const status = await this.performMappingUpload()
      const totalTime = (Date.now() - initialTime) / 1000

      this.context.stdout.write(renderCommandSummary([status], totalTime, this.dryRun))
    } catch (e) {
      this.context.stderr.write(renderGeneralizedError(e))

      return 1
    }

    return 0
  }

  private async getGitMetadata(): Promise<RepositoryData | undefined> {
    try {
      return await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }

    return undefined
  }

  private getMetadata(): JvmMappingMetadata {
    return {
      build_id: this.resolvedBuildId!,
      cli_version: this.cliVersion,
      service: this.serviceName!.trim(),
      type: TYPE_JVM_MAPPING,
      variant: this.variant.trim(),
      version: this.version!.trim(),
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
    }
  }

  private async performMappingUpload(): Promise<UploadStatus> {
    const mappingFile = this.mappingFile!
    const metadata = this.getMetadata()
    const eventValue = JSON.stringify(metadata)
    this.context.stdout.write(renderEventPayload(eventValue))

    if (this.dryRun) {
      this.context.stdout.write(`[DRYRUN] ${renderUpload(mappingFile)}`)

      return UploadStatus.Success
    }

    const metricsLogger = await getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:jvm'],
      prefix: 'datadog.ci.jvm_mapping_symbols.',
    })
    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
    const requestBuilder = getJvmMappingSymbolsRequestBuilder(
      this.config.apiKey,
      this.cliVersion,
      this.config.datadogSite
    )

    const payload = {
      content: new Map<string, MultipartValue>([
        [
          'event',
          {
            type: 'string',
            value: eventValue,
            options: {filename: 'event', contentType: 'application/json'},
          },
        ],
        [VALUE_NAME_JVM_MAPPING, {type: 'file', path: mappingFile, options: {filename: JVM_MAPPING_FILE_NAME}}],
      ]),
    }
    if (this.gitRepositoryPayload !== undefined) {
      payload.content.set('repository', this.gitRepositoryPayload)
    }

    try {
      return await uploadMultipartHelper(requestBuilder, payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(mappingFile, e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempts) => {
          this.context.stdout.write(renderRetriedUpload(mappingFile, (e as Error).message, attempts))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          this.context.stdout.write(renderUpload(mappingFile))
        },
        retries: 5,
        useGzip: true,
      })
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private readBuildId(): string | undefined {
    if ((this.buildId === undefined) === (this.buildIdFile === undefined)) {
      this.context.stderr.write(renderBuildIdOptionsError())

      return undefined
    }

    let buildId = this.buildId
    if (this.buildIdFile !== undefined) {
      try {
        if (fs.statSync(this.buildIdFile).size > MAX_BUILD_ID_FILE_SIZE) {
          this.context.stderr.write(renderBuildIdFileTooLarge(this.buildIdFile))

          return undefined
        }
        buildId = fs.readFileSync(this.buildIdFile, 'utf8')
      } catch (error) {
        this.context.stderr.write(renderUnreadableBuildIdFile(this.buildIdFile, (error as Error).message))

        return undefined
      }
    }

    // The Android SDK keeps a byte order mark as part of the ID it sends, while trimming here would remove it:
    // the uploaded ID would then never match the app's events.
    if (buildId!.startsWith(BYTE_ORDER_MARK)) {
      this.context.stderr.write(renderBuildIdWithByteOrderMark())

      return undefined
    }

    // Trimmed, as a file usually ends with a newline. The ID is otherwise sent exactly as given: the backend
    // matches mapping files to events by an exact comparison of the build ID.
    const trimmed = buildId!.trim()
    if (!UUID_REGEX.test(trimmed)) {
      this.context.stderr.write(renderInvalidBuildId(trimmed))

      return undefined
    }

    return trimmed
  }

  private verifyParameters(): boolean {
    let parametersOkay = true

    if (!this.mappingFile) {
      this.context.stderr.write(renderArgumentMissingError('mapping file'))
      parametersOkay = false
    } else {
      const stats = fs.existsSync(this.mappingFile) ? fs.statSync(this.mappingFile) : undefined
      if (!stats) {
        this.context.stderr.write(renderInvalidMappingFile(this.mappingFile, 'does not exist'))
        parametersOkay = false
      } else if (!stats.isFile()) {
        this.context.stderr.write(renderInvalidMappingFile(this.mappingFile, 'is not a file'))
        parametersOkay = false
      } else if (stats.size === 0) {
        this.context.stderr.write(renderInvalidMappingFile(this.mappingFile, 'is empty'))
        parametersOkay = false
      } else if (!isReadable(this.mappingFile)) {
        this.context.stderr.write(renderInvalidMappingFile(this.mappingFile, 'cannot be read'))
        parametersOkay = false
      }
    }

    this.resolvedBuildId = this.readBuildId()
    if (this.resolvedBuildId === undefined) {
      parametersOkay = false
    }

    // The backend requires both to store a mapping file.
    if (!this.serviceName?.trim()) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))
      parametersOkay = false
    }
    if (!this.version?.trim()) {
      this.context.stderr.write(renderArgumentMissingError('version'))
      parametersOkay = false
    }

    return parametersOkay
  }
}

const isReadable = (path: string): boolean => {
  try {
    fs.accessSync(path, fs.constants.R_OK)

    return true
  } catch {
    return false
  }
}
