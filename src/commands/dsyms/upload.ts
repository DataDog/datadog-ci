import {promises} from 'fs'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import upath from 'upath'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {toBoolean} from '../../helpers/env'
import {InvalidConfigurationError} from '../../helpers/errors'
import {enableFips} from '../../helpers/fips'
import {globSync} from '../../helpers/glob'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {upload, UploadStatus} from '../../helpers/upload'
import {buildPath, getRequestBuilder, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import {CompressedDsym, Dsym, DWARF} from './interfaces'
import {
  renderCommandDetail,
  renderCommandInfo,
  renderConfigurationError,
  renderDSYMSlimmingFailure,
  renderFailedUpload,
  renderInvalidDsymWarning,
  renderRetriedUpload,
  renderSuccessfulCommand,
  renderUpload,
} from './renderer'
import {
  createUniqueTmpDirectory,
  deleteDirectory,
  executeDwarfdump,
  executeLipo,
  getBaseIntakeUrl,
  isZipFile,
  unzipArchiveToDirectory,
  zipDirectoryToArchive,
} from './utils'

export class UploadCommand extends Command {
  public static paths = [['dsyms', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload dSYM files to Datadog.',
    details: `
      This command will upload all dSYM files to Datadog in order to symbolicate crash reports received by Datadog.\n
      See README for details.
    `,
    examples: [
      ['Upload all dSYM files in Derived Data path', 'datadog-ci dsyms upload ~/Library/Developer/Xcode/DerivedData'],
      [
        'Upload all dSYM files in a zip file (this is usually the case if your app has Bitcode enabled)',
        'datadog-ci dsyms upload /path/to/folder/my_file.zip',
      ],
    ],
  })

  private basePath = Option.String({required: true})
  private configPath = Option.String('--config')
  private dryRun = Option.Boolean('--dry-run', false)
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})

  private cliVersion = version
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  } as const

  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    this.basePath = upath.normalize(this.basePath)
    this.context.stdout.write(renderCommandInfo(this.basePath, this.maxConcurrency, this.dryRun))

    await this.loadConfig()

    const {metricsLogger, apiKeyValidator} = this.createServices()
    const initialTime = Date.now()

    try {
      const tmpDirectory = await createUniqueTmpDirectory()

      try {
        const results = await this.processAndUploadDsyms(tmpDirectory, metricsLogger, apiKeyValidator)
        const totalTime = (Date.now() - initialTime) / 1000

        this.context.stdout.write(renderSuccessfulCommand(results, totalTime, this.dryRun))
        metricsLogger.logger.gauge('duration', totalTime)

        return 0
      } finally {
        await deleteDirectory(tmpDirectory)
      }
    } catch (error) {
      if (error instanceof InvalidConfigurationError) {
        this.context.stdout.write(renderConfigurationError(error))

        return 1
      }
      throw error
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private async loadConfig() {
    this.config = await resolveConfigFromFileAndEnvironment(
      this.config,
      {
        apiKey: process.env.DATADOG_API_KEY,
        datadogSite: process.env.DATADOG_SITE,
      },
      {
        configPath: this.configPath,
        defaultConfigPaths: ['datadog-ci.json', '../datadog-ci.json'],
        configFromFileCallback: (configFromFile: any) => {
          checkAPIKeyOverride(process.env.DATADOG_API_KEY, configFromFile.apiKey, this.context.stdout)
        },
      }
    )
  }

  private createServices() {
    const metricsLogger = getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`],
      prefix: 'datadog.ci.dsyms.',
    })

    const apiKeyValidator = newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })

    return {metricsLogger, apiKeyValidator}
  }

  private async processAndUploadDsyms(
    tmpDirectory: string,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ) {
    const intermediateDirectory = buildPath(tmpDirectory, 'datadog-ci', 'dsyms', 'intermediate')
    const uploadDirectory = buildPath(tmpDirectory, 'datadog-ci', 'dsyms', 'upload')

    this.context.stdout.write(renderCommandDetail(intermediateDirectory, uploadDirectory))

    const searchDirectory = await this.prepareSearchDirectory(tmpDirectory)
    const dsyms = await this.findDsyms(searchDirectory)

    const thinDsyms = await this.processDsyms(dsyms, intermediateDirectory)
    const compressedDsyms = await this.compressDsyms(thinDsyms, uploadDirectory)

    const requestBuilder = this.createRequestBuilder()
    const uploadFunction = this.createUploadFunction(requestBuilder, metricsLogger, apiKeyValidator)

    return doWithMaxConcurrency(this.maxConcurrency, compressedDsyms, uploadFunction)
  }

  private async prepareSearchDirectory(tmpDirectory: string): Promise<string> {
    if (await isZipFile(this.basePath)) {
      await unzipArchiveToDirectory(this.basePath, tmpDirectory)

      return tmpDirectory
    }

    return this.basePath
  }

  private async findDsyms(directoryPath: string): Promise<Dsym[]> {
    const dsymPaths = globSync(buildPath(directoryPath, '**/*.dSYM'))

    const results = await Promise.all(
      dsymPaths.map(async (bundle) => {
        try {
          const {stdout} = await executeDwarfdump(bundle)
          const dwarf = this.parseDwarfdumpOutput(stdout)

          return [{bundle, dwarf}]
        } catch {
          this.context.stdout.write(renderInvalidDsymWarning(bundle))

          return []
        }
      })
    )

    return results.flat()
  }

  /**
   * Parses the output of `dwarfdump --uuid` command (ref.: https://www.unix.com/man-page/osx/1/dwarfdump/).
   * It returns one or many DWARF UUID and arch read from the output.
   *
   * Example `dwarfdump --uuid` output:
   * ```
   * $ dwarfdump --uuid DDTest.framework.dSYM
   * UUID: C8469F85-B060-3085-B69D-E46C645560EA (armv7) DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest
   * UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E (arm64) DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest
   * ```
   */
  private parseDwarfdumpOutput(output: string): DWARF[] {
    const lineRegexp = /UUID: ([0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}) \(([a-z0-9_]+)\) (.+)/

    return output
      .split('\n')
      .map((line) => {
        const match = line.match(lineRegexp)

        return match ? [{uuid: match[1], arch: match[2], object: match[3]}] : []
      })
      .flat()
  }

  /**
   * It takes `N` dSYMs and returns `N` or more dSYMs. If a dSYM includes more than one arch slice,
   * it will be thinned by extracting each arch to a new dSYM in `output`.
   */
  private async processDsyms(dsyms: Dsym[], output: string): Promise<Dsym[]> {
    await promises.mkdir(output, {recursive: true})

    const results = await Promise.all(
      dsyms.map(async (dsym) => {
        // Reduce dSYMs size by extracting single UUIDs and arch slices from fat dSYMs to separate
        // single-arch dSYMs in intermediate location. This is to avoid exceeding intake limit whenever possible.
        return dsym.dwarf.length > 1 ? this.thinDsym(dsym, output) : [dsym]
      })
    )

    return results.flat()
  }

  /**
   * It takes fat dSYM as input and returns multiple dSYMs by extracting **each arch**
   * to separate dSYM file. New files are saved to `output` and named by their object uuid (`<uuid>.dSYM`).
   *
   * For example, given `<source path>/Foo.dSYM/Contents/Resources/DWARF/Foo` dSYM with two arch slices: `arm64` (uuid1)
   * and `x86_64` (uuid2), it will:
   * - create `<intermediate path>/<uuid1>.dSYM/Contents/Resources/DWARF/Foo` for `arm64`,
   * - create `<intermediate path>/<uuid2>.dSYM/Contents/Resources/DWARF/Foo` for `x86_64`.
   */
  private async thinDsym(dsym: Dsym, output: string): Promise<Dsym[]> {
    const results = await Promise.all(
      dsym.dwarf.map(async (dwarf) => {
        try {
          const bundle = buildPath(output, `${dwarf.uuid}.dSYM`)
          const object = buildPath(bundle, upath.relative(dsym.bundle, dwarf.object))

          await promises.mkdir(upath.dirname(object), {recursive: true})

          try {
            await executeLipo(dwarf.object, dwarf.arch, object)
          } catch {
            await promises.copyFile(dwarf.object, object)
          }

          await this.copyInfoPlist(dsym.bundle, bundle)

          return [{bundle, dwarf: [{...dwarf, object}]}]
        } catch (error) {
          this.context.stdout.write(renderDSYMSlimmingFailure(dsym, dwarf, error))

          return []
        }
      })
    )

    return results.flat()
  }

  private async copyInfoPlist(src: string, dst: string) {
    const infoPlistPaths = globSync(buildPath(src, '**/Info.plist'))
    if (infoPlistPaths.length === 0) {
      return
    }

    const infoPlistPath = infoPlistPaths[0]
    const newInfoPlistPath = buildPath(dst, upath.relative(src, infoPlistPath))

    await promises.mkdir(upath.dirname(newInfoPlistPath), {recursive: true})
    await promises.copyFile(infoPlistPath, newInfoPlistPath)
  }

  private async compressDsyms(dsyms: Dsym[], output: string): Promise<CompressedDsym[]> {
    await promises.mkdir(output, {recursive: true})

    return Promise.all(
      dsyms.map(async (dsym) => {
        const archivePath = buildPath(output, `${dsym.dwarf[0].uuid}.zip`)
        await zipDirectoryToArchive(dsym.bundle, archivePath)

        return new CompressedDsym(archivePath, dsym)
      })
    )
  }

  private createRequestBuilder(): RequestBuilder {
    if (!this.config.apiKey) {
      throw new InvalidConfigurationError(`Missing ${chalk.bold('DATADOG_API_KEY')} in your environment.`)
    }

    return getRequestBuilder({
      apiKey: this.config.apiKey,
      baseUrl: getBaseIntakeUrl(this.config.datadogSite),
      headers: new Map([
        ['DD-EVP-ORIGIN', 'datadog-ci_dsyms'],
        ['DD-EVP-ORIGIN-VERSION', this.cliVersion],
      ]),
      overrideUrl: 'api/v2/srcmap',
    })
  }

  private createUploadFunction(
    requestBuilder: RequestBuilder,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): (dsym: CompressedDsym) => Promise<UploadStatus> {
    return async (dsym: CompressedDsym) => {
      const payload = dsym.asMultipartPayload()

      if (this.dryRun) {
        this.context.stdout.write(`[DRYRUN] ${renderUpload(dsym)}`)

        return UploadStatus.Success
      }

      return upload(requestBuilder)(payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(dsym, e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempts) => {
          this.context.stdout.write(renderRetriedUpload(dsym, e.message, attempts))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          this.context.stdout.write(renderUpload(dsym))
        },
        retries: 5,
      })
    }
  }
}
