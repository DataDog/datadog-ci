import {promises} from 'fs'
import path from 'path'

import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {ApiKeyValidator, newApiKeyValidator} from '../../helpers/apikey'
import {doWithMaxConcurrency} from '../../helpers/concurrency'
import {toBoolean} from '../../helpers/env'
import {InvalidConfigurationError} from '../../helpers/errors'
import {enableFips} from '../../helpers/fips'
import {globSync} from '../../helpers/fs'
import {RequestBuilder} from '../../helpers/interfaces'
import {getMetricsLogger, MetricsLogger} from '../../helpers/metrics'
import {upload, UploadStatus} from '../../helpers/upload'
import {buildPath, getRequestBuilder, resolveConfigFromFileAndEnvironment} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {checkAPIKeyOverride} from '../../helpers/validation'
import {version} from '../../helpers/version'

import {ArchSlice, CompressedDsym, Dsym} from './interfaces'
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

    // Normalizing the basePath to resolve .. and .
    this.basePath = path.posix.normalize(this.basePath)
    this.context.stdout.write(renderCommandInfo(this.basePath, this.maxConcurrency, this.dryRun))

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
    const initialTime = Date.now()
    const tmpDirectory = await createUniqueTmpDirectory()
    const intermediateDirectory = buildPath(tmpDirectory, 'datadog-ci', 'dsyms', 'intermediate')
    const uploadDirectory = buildPath(tmpDirectory, 'datadog-ci', 'dsyms', 'upload')

    this.context.stdout.write(renderCommandDetail(intermediateDirectory, uploadDirectory))

    // The CLI input path can be a folder or `.zip` archive with `*.dSYM` files.
    // In case of `.zip`, extract it to temporary location, so it can be handled the same way as folder.
    let dSYMsSearchDirectory = this.basePath
    if (await isZipFile(this.basePath)) {
      await unzipArchiveToDirectory(this.basePath, tmpDirectory)
      dSYMsSearchDirectory = tmpDirectory
    }
    const dsyms = await this.findDSYMsInDirectory(dSYMsSearchDirectory)

    // Reduce dSYMs size by extracting arch slices from fat dSYMs to separate single-arch dSYMs in intermediate location.
    // This is to avoid exceeding intake limit whenever possible.
    const slimDSYMs = await this.thinDSYMs(dsyms, intermediateDirectory)
    // Compress each dSYM into single `.zip` archive.
    const compressedDSYMs = await this.compressDSYMsToDirectory(slimDSYMs, uploadDirectory)

    const requestBuilder = this.getRequestBuilder()
    const uploadDSYM = this.uploadDSYM(requestBuilder, metricsLogger, apiKeyValidator)
    try {
      const results = await doWithMaxConcurrency(this.maxConcurrency, compressedDSYMs, uploadDSYM)
      const totalTime = (Date.now() - initialTime) / 1000
      this.context.stdout.write(renderSuccessfulCommand(results, totalTime, this.dryRun))
      metricsLogger.logger.gauge('duration', totalTime)

      return 0
    } catch (error) {
      if (error instanceof InvalidConfigurationError) {
        this.context.stdout.write(renderConfigurationError(error))

        return 1
      }
      // Otherwise unknown error, let's propagate the exception
      throw error
    } finally {
      await deleteDirectory(tmpDirectory)
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private compressDSYMsToDirectory = async (dsyms: Dsym[], directoryPath: string): Promise<CompressedDsym[]> => {
    await promises.mkdir(directoryPath, {recursive: true})

    return Promise.all(
      dsyms.map(async (dsym) => {
        const archivePath = buildPath(directoryPath, `${dsym.slices[0].uuid}.zip`)
        await zipDirectoryToArchive(dsym.bundlePath, archivePath)

        return new CompressedDsym(archivePath, dsym)
      })
    )
  }

  private findDSYMsInDirectory = async (directoryPath: string): Promise<Dsym[]> => {
    const dsyms: Dsym[] = []
    for (const dSYMPath of globSync(buildPath(directoryPath, '**/*.dSYM'))) {
      try {
        const stdout = (await executeDwarfdump(dSYMPath)).stdout
        const archSlices = this.parseDwarfdumpOutput(stdout)
        dsyms.push({bundlePath: dSYMPath, slices: archSlices})
      } catch {
        this.context.stdout.write(renderInvalidDsymWarning(dSYMPath))
      }
    }

    return Promise.all(dsyms)
  }

  private getRequestBuilder(): RequestBuilder {
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

  /**
   * Parses the output of `dwarfdump --uuid` command (ref.: https://www.unix.com/man-page/osx/1/dwarfdump/).
   * It returns one or many arch slices read from the output.
   *
   * Example `dwarfdump --uuid` output:
   * ```
   * $ dwarfdump --uuid DDTest.framework.dSYM
   * UUID: C8469F85-B060-3085-B69D-E46C645560EA (armv7) DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest
   * UUID: 06EE3D68-D605-3E92-B92D-2F48C02A505E (arm64) DDTest.framework.dSYM/Contents/Resources/DWARF/DDTest
   * ```
   */
  private parseDwarfdumpOutput = (output: string): ArchSlice[] => {
    const lineRegexp = /UUID: ([0-9A-F]{8}-(?:[0-9A-F]{4}-){3}[0-9A-F]{12}) \(([a-z0-9_]+)\) (.+)/

    return output
      .split('\n')
      .map((line) => {
        const match = line.match(lineRegexp)

        return match ? [{arch: match[2], objectPath: match[3], uuid: match[1]}] : []
      })
      .reduce((acc, nextSlice) => acc.concat(nextSlice), [])
  }

  /**
   * It takes fat dSYM as input and returns multiple dSYMs by extracting **each arch**
   * to separate dSYM file. New files are saved to `intermediatePath` and named by their object uuid (`<uuid>.dSYM`).
   *
   * For example, given `<source path>/Foo.dSYM/Contents/Resources/DWARF/Foo` dSYM with two arch slices: `arm64` (uuid1)
   * and `x86_64` (uuid2), it will:
   * - create `<intermediate path>/<uuid1>.dSYM/Contents/Resources/DWARF/Foo` for `arm64`,
   * - create `<intermediate path>/<uuid2>.dSYM/Contents/Resources/DWARF/Foo` for `x86_64`.
   */
  private thinDSYM = async (dsym: Dsym, intermediatePath: string): Promise<Dsym[]> => {
    const slimmedDSYMs: Dsym[] = []
    for (const slice of dsym.slices) {
      try {
        const newDSYMBundleName = `${slice.uuid}.dSYM`
        const newDSYMBundlePath = buildPath(intermediatePath, newDSYMBundleName)
        const newObjectPath = buildPath(newDSYMBundlePath, path.relative(dsym.bundlePath, slice.objectPath))

        // Extract arch slice:
        await promises.mkdir(path.dirname(newObjectPath), {recursive: true})
        await executeLipo(slice.objectPath, slice.arch, newObjectPath)

        // The original dSYM bundle can also include `Info.plist` file, so copy it to the `<uuid>.dSYM` as well.
        // Ref.: https://opensource.apple.com/source/lldb/lldb-179.1/www/symbols.html
        const infoPlistPath = globSync(buildPath(dsym.bundlePath, '**/Info.plist'))[0]
        if (infoPlistPath) {
          const newInfoPlistPath = buildPath(newDSYMBundlePath, path.relative(dsym.bundlePath, infoPlistPath))
          await promises.mkdir(path.dirname(newInfoPlistPath), {recursive: true})
          await promises.copyFile(infoPlistPath, newInfoPlistPath)
        }

        slimmedDSYMs.push({
          bundlePath: newDSYMBundlePath,
          slices: [{arch: slice.arch, uuid: slice.uuid, objectPath: newObjectPath}],
        })
      } catch {
        this.context.stdout.write(renderDSYMSlimmingFailure(dsym, slice))
      }
    }

    return Promise.all(slimmedDSYMs)
  }

  /**
   * It takes `N` dSYMs and returns `N` or more dSYMs. If a dSYM includes more than one arch slice,
   * it will be thinned by extracting each arch to a new dSYM in `intermediatePath`.
   */
  private thinDSYMs = async (dsyms: Dsym[], intermediatePath: string): Promise<Dsym[]> => {
    await promises.mkdir(intermediatePath, {recursive: true})
    let slimDSYMs: Dsym[] = []

    for (const dsym of dsyms) {
      if (dsym.slices.length > 1) {
        slimDSYMs = slimDSYMs.concat(await this.thinDSYM(dsym, intermediatePath))
      } else {
        slimDSYMs.push(dsym)
      }
    }

    return Promise.all(slimDSYMs)
  }

  private uploadDSYM(
    requestBuilder: RequestBuilder,
    metricsLogger: MetricsLogger,
    apiKeyValidator: ApiKeyValidator
  ): (dSYM: CompressedDsym) => Promise<UploadStatus> {
    return async (dSYM: CompressedDsym) => {
      const payload = dSYM.asMultipartPayload()
      if (this.dryRun) {
        this.context.stdout.write(`[DRYRUN] ${renderUpload(dSYM)}`)

        return UploadStatus.Success
      }

      return upload(requestBuilder)(payload, {
        apiKeyValidator,
        onError: (e) => {
          this.context.stdout.write(renderFailedUpload(dSYM, e.message))
          metricsLogger.logger.increment('failed', 1)
        },
        onRetry: (e, attempts) => {
          this.context.stdout.write(renderRetriedUpload(dSYM, e.message, attempts))
          metricsLogger.logger.increment('retries', 1)
        },
        onUpload: () => {
          this.context.stdout.write(renderUpload(dSYM))
        },
        retries: 5,
      })
    }
  }
}
