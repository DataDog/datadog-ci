import {createHash} from 'crypto'
import fs from 'fs'

import type {NdkArch, NdkSymbolFileMetadata} from './interfaces'
import type {NativeLibraryInfo} from './ndk'
import type {RepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import type {MetricsLogger} from '@datadog/datadog-ci-base/helpers/metrics'
import type {MultipartValue} from '@datadog/datadog-ci-base/helpers/upload'

import {Command, Option} from 'clipanion'
import * as t from 'typanion'
import upath from 'upath'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSiteFromEnv} from '@datadog/datadog-ci-base/helpers/api'
import {newApiKeyValidator} from '@datadog/datadog-ci-base/helpers/apikey'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
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

import {getNdkSymbolsRequestBuilder, uploadMultipartHelper} from './helpers'
import {TYPE_NDK_SYMBOL_FILE, VALUE_NAME_NDK_SYMBOL_FILE} from './interfaces'
import {readNativeLibraryInfo} from './ndk'
import {
  renderAllLibrariesStripped,
  renderArgumentMissingError,
  renderCommandInfo,
  renderCommandSummary,
  renderConflictingLibraries,
  renderCounts,
  renderDebugOnlyFile,
  renderDuplicate,
  renderFailedUpload,
  renderGeneralizedError,
  renderGitWarning,
  renderInvalidBuildId,
  renderInvalidSymbolsLocation,
  renderNoSymbols,
  renderNotANativeLibrary,
  renderRetriedUpload,
  renderUnexpectedName,
  renderUnreadableFile,
  renderUnreadableFolder,
  renderUnverifiedLibrary,
  renderUpload,
} from './renderer'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Android only extracts and loads native libraries whose name has this shape.
const ANDROID_LIBRARY_NAME_REGEX = /^lib.+\.so$/

type LibraryToUpload = NativeLibraryInfo & {arch: NdkArch}

type FoundFiles = {
  files: string[]
  unreadableFolders: {path: string; error: string}[]
}

type Selection = {
  toUpload: LibraryToUpload[]
  // One status per file that won't be uploaded.
  notUploaded: UploadStatus[]
}

export class NdkSymbolsUploadCommand extends BaseCommand {
  public static paths = [['ndk-symbols', 'upload']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Upload Android native libraries (NDK symbol files) to Datadog.',
    details: `
      This command uploads the Android native libraries (lib*.so files) found in the given location(s), so that
      native crashes of the app with the given build ID can be symbolicated.
      Each library is uploaded as it is, under the name native crash frames show for it, with its
      architecture read from the file itself. Libraries that have no symbols are skipped.
    `,
    examples: [
      [
        'Upload the native libraries of all ABIs in the given directory',
        'datadog-ci ndk-symbols upload ./native-symbols --build-id 01234567-89ab-cdef-0123-456789abcdef',
      ],
    ],
  })

  public static authRequirement = apiKeyAuth

  private buildId = Option.String('--build-id', {
    description: "Required. The build ID of the app, as shipped in its 'assets/datadog.buildId' file: a UUID.",
  })
  private serviceName = Option.String('--service-name', {description: 'The service name of the app.'})
  private version = Option.String('--version', {description: 'The version of the app.'})
  private variant = Option.String('--variant', {description: 'The variant (flavor) of the app.'})
  private disableGit = Option.Boolean('--disable-git', false)
  private dryRun = Option.Boolean('--dry-run', false)
  private configPath = Option.String('--config')
  private maxConcurrency = Option.String('--max-concurrency', '20', {
    validator: t.cascade(t.isNumber(), [t.isInteger(), t.isAtLeast(1)]),
  })
  private repositoryUrl = Option.String('--repository-url')
  private symbolsLocations = Option.Rest({required: 1})

  private cliVersion = cliVersion
  private config: Record<string, string> = {
    datadogSite: 'datadoghq.com',
  }
  private gitData?: RepositoryData
  private gitRepositoryPayload?: MultipartValue

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

    this.context.stdout.write(renderCommandInfo(this.dryRun, this.buildId!, this.symbolsLocations))

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
      const callResults = await this.performNdkSymbolsUpload()
      const totalTime = (Date.now() - initialTime) / 1000

      this.context.stdout.write(renderCommandSummary(callResults, totalTime, this.dryRun))
    } catch (e) {
      this.context.stderr.write(renderGeneralizedError(e))

      return 1
    }

    return 0
  }

  private getApiKeyValidator(metricsLogger: MetricsLogger) {
    return newApiKeyValidator({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      metricsLogger: metricsLogger.logger,
    })
  }

  private async getGitMetadata(): Promise<RepositoryData | undefined> {
    try {
      return await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }

    return undefined
  }

  private getMetadata(arch: NdkArch): NdkSymbolFileMetadata {
    return {
      arch,
      build_id: this.buildId!,
      cli_version: this.cliVersion,
      type: TYPE_NDK_SYMBOL_FILE,
      service: this.serviceName,
      version: this.version,
      variant: this.variant,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
    }
  }

  private getMetricsLogger() {
    return getMetricsLogger({
      apiKey: this.config.apiKey,
      datadogSite: this.config.datadogSite,
      defaultTags: [`cli_version:${this.cliVersion}`, 'platform:android'],
      prefix: 'datadog.ci.ndk_symbols.',
    })
  }

  /**
   * Lists the .so files of a location: the file itself, or the files found recursively in a folder. The location is
   * taken literally, symbolic links to folders are followed (each folder is visited once), and folders that can't
   * be read are reported instead of being silently left out.
   */
  private async findLibraryFiles(symbolsLocation: string): Promise<FoundFiles> {
    const found: FoundFiles = {files: [], unreadableFolders: []}
    const stat = await fs.promises.stat(symbolsLocation)
    if (!stat.isDirectory()) {
      found.files.push(symbolsLocation)

      return found
    }

    const visitedFolders = new Set<string>()
    const walk = async (folder: string): Promise<void> => {
      let entries: fs.Dirent[]
      try {
        const realFolder = await fs.promises.realpath(folder)
        if (visitedFolders.has(realFolder)) {
          return
        }
        visitedFolders.add(realFolder)
        entries = await fs.promises.readdir(folder, {withFileTypes: true})
      } catch (error) {
        found.unreadableFolders.push({path: folder, error: (error as Error).message})

        return
      }

      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const path = upath.join(folder, entry.name)
        let isFolder = entry.isDirectory()
        let isFile = entry.isFile()
        if (entry.isSymbolicLink()) {
          try {
            const target = await fs.promises.stat(path)
            isFolder = target.isDirectory()
            isFile = target.isFile()
          } catch {
            // A broken link named like a library is reported when it's read.
            isFile = true
          }
        }
        if (isFolder) {
          await walk(path)
        } else if (isFile && entry.name.endsWith('.so')) {
          found.files.push(path)
        }
      }
    }
    await walk(symbolsLocation)

    return found
  }

  /**
   * Lists the files of all the locations once each: the same file can be reached through several paths
   * (overlapping locations, relative and absolute paths, symbolic links). A link with another name than its target
   * is kept, since the name is what the library is uploaded under.
   */
  private async findAllLibraryFiles(): Promise<FoundFiles> {
    const all: FoundFiles = {files: [], unreadableFolders: []}
    const seen = new Set<string>()
    for (const location of this.symbolsLocations) {
      const found = await this.findLibraryFiles(location)
      all.unreadableFolders.push(...found.unreadableFolders)
      for (const path of found.files) {
        const realPath = await fs.promises.realpath(path).catch(() => path)
        const key = `${realPath}\0${upath.basename(path)}`
        if (!seen.has(key)) {
          seen.add(key)
          all.files.push(path)
        }
      }
    }

    return all
  }

  /**
   * Reads every candidate file and decides what to upload. For a build ID, the backend stores one library per file
   * name and architecture, and keeps the first one it receives, so libraries that conflict are not uploaded at all.
   */
  private async selectLibraries(paths: string[]): Promise<Selection> {
    // Keep the input order: results of a concurrent read come back in the order they finish.
    const indexedLibraries = await doWithMaxConcurrency(this.maxConcurrency, [...paths.keys()], async (index) => ({
      index,
      library: await readNativeLibraryInfo(paths[index]),
    }))
    const libraries = indexedLibraries.sort((a, b) => a.index - b.index).map(({library}) => library)

    const notUploaded: UploadStatus[] = []
    const candidatesByKey = new Map<string, LibraryToUpload[]>()
    // Names of files that couldn't be read: one of them may conflict with a readable library of the same name.
    const unreadableNames = new Set<string>()
    let androidLibraries = 0
    let withoutSymbols = 0

    for (const library of libraries) {
      if (library.readError !== undefined) {
        this.context.stdout.write(renderUnreadableFile(library.path, library.readError))
        unreadableNames.add(library.filename)
        notUploaded.push(UploadStatus.Failure)
        continue
      }
      if (library.arch === undefined) {
        this.context.stdout.write(renderNotANativeLibrary(library.path, library.notALibraryReason ?? 'unknown reason'))
        notUploaded.push(UploadStatus.Skipped)
        continue
      }
      androidLibraries++
      if (!ANDROID_LIBRARY_NAME_REGEX.test(library.filename)) {
        this.context.stdout.write(renderUnexpectedName(library.path))
        notUploaded.push(UploadStatus.Skipped)
        continue
      }
      if (!library.hasSymbols) {
        this.context.stdout.write(renderNoSymbols(library.path))
        withoutSymbols++
        notUploaded.push(UploadStatus.Skipped)
        continue
      }
      if (!library.hasCode) {
        this.context.stdout.write(renderDebugOnlyFile(library.path))
        notUploaded.push(UploadStatus.Skipped)
        continue
      }

      const key = `${library.arch}/${library.filename}`
      candidatesByKey.set(key, [...(candidatesByKey.get(key) ?? []), {...library, arch: library.arch}])
    }

    const toUpload: LibraryToUpload[] = []
    for (const candidates of candidatesByKey.values()) {
      const [first, ...others] = candidates
      if (unreadableNames.has(first.filename)) {
        this.context.stdout.write(renderUnverifiedLibrary(first.arch, first.filename))
        candidates.forEach(() => notUploaded.push(UploadStatus.Failure))
        continue
      }
      if (others.length === 0) {
        toUpload.push(first)
        continue
      }

      let hashes: string[]
      try {
        hashes = await Promise.all(candidates.map((candidate) => hashFile(candidate.path)))
      } catch (error) {
        candidates.forEach((candidate) => {
          this.context.stdout.write(renderUnreadableFile(candidate.path, (error as Error).message))
          notUploaded.push(UploadStatus.Failure)
        })
        continue
      }
      if (hashes.every((hash) => hash === hashes[0])) {
        // The same content found at several places: upload it once.
        others.forEach((other) => this.context.stdout.write(renderDuplicate(other.path, first.path)))
        toUpload.push(first)
      } else {
        this.context.stdout.write(
          renderConflictingLibraries(
            first.arch,
            first.filename,
            candidates.map((candidate) => candidate.path)
          )
        )
        candidates.forEach(() => notUploaded.push(UploadStatus.Failure))
      }
    }

    if (toUpload.length === 0 && withoutSymbols > 0 && withoutSymbols === androidLibraries) {
      this.context.stdout.write(renderAllLibrariesStripped(withoutSymbols))
    }

    return {toUpload, notUploaded}
  }

  private async performNdkSymbolsUpload(): Promise<UploadStatus[]> {
    const {files, unreadableFolders} = await this.findAllLibraryFiles()
    unreadableFolders.forEach((folder) => this.context.stdout.write(renderUnreadableFolder(folder.path, folder.error)))
    const selection = await this.selectLibraries(files)
    const toUpload = selection.toUpload
    const notUploaded = [...unreadableFolders.map(() => UploadStatus.Failure), ...selection.notUploaded]

    const countStatuses = (statuses: UploadStatus[]) => {
      const count = (status: UploadStatus) => statuses.filter((value) => value === status).length
      this.context.stdout.write(
        renderCounts(count(UploadStatus.Success), count(UploadStatus.Skipped), count(UploadStatus.Failure), this.dryRun)
      )

      return statuses
    }

    if (this.dryRun) {
      toUpload.forEach((library) => this.context.stdout.write(`[DRYRUN] ${renderUpload(library.path, library.arch)}`))

      return countStatuses([...notUploaded, ...toUpload.map(() => UploadStatus.Success)])
    }

    const metricsLogger = await this.getMetricsLogger()
    const apiKeyValidator = this.getApiKeyValidator(metricsLogger)
    const requestBuilder = getNdkSymbolsRequestBuilder(this.config.apiKey, this.cliVersion, this.config.datadogSite)

    try {
      const uploaded = await doWithMaxConcurrency(this.maxConcurrency, toUpload, async (library) => {
        const payload = {
          content: new Map<string, MultipartValue>([
            [
              'event',
              {
                type: 'string',
                value: JSON.stringify(this.getMetadata(library.arch)),
                options: {filename: 'event', contentType: 'application/json'},
              },
            ],
            // The file name is how the backend matches the library to native crash frames.
            [VALUE_NAME_NDK_SYMBOL_FILE, {type: 'file', path: library.path, options: {filename: library.filename}}],
          ]),
        }
        if (this.gitRepositoryPayload !== undefined) {
          payload.content.set('repository', this.gitRepositoryPayload)
        }

        return uploadMultipartHelper(requestBuilder, payload, {
          apiKeyValidator,
          onError: (e) => {
            this.context.stdout.write(renderFailedUpload(library.path, e.message))
            metricsLogger.logger.increment('failed', 1)
          },
          onRetry: (e, attempts) => {
            this.context.stdout.write(renderRetriedUpload(library.path, (e as Error).message, attempts))
            metricsLogger.logger.increment('retries', 1)
          },
          onUpload: () => {
            this.context.stdout.write(renderUpload(library.path, library.arch))
          },
          retries: 5,
          useGzip: true,
        })
      })

      return countStatuses([...notUploaded, ...uploaded])
    } finally {
      try {
        await metricsLogger.flush()
      } catch (err) {
        this.context.stdout.write(`WARN: ${err}\n`)
      }
    }
  }

  private verifyParameters(): boolean {
    let parametersOkay = true

    if (!this.symbolsLocations || this.symbolsLocations.length === 0) {
      this.context.stderr.write(renderArgumentMissingError('symbols locations'))
      parametersOkay = false
    } else {
      for (const symbolsLocation of this.symbolsLocations) {
        const stats = fs.existsSync(symbolsLocation) ? fs.statSync(symbolsLocation) : undefined
        if (!stats || (!stats.isDirectory() && !stats.isFile())) {
          this.context.stderr.write(renderInvalidSymbolsLocation(symbolsLocation))
          parametersOkay = false
        }
      }
    }

    // Trimmed, so that an ID read from a file with a trailing newline is accepted.
    const buildId = this.buildId?.trim()
    if (!buildId) {
      this.context.stderr.write(renderArgumentMissingError('build-id'))
      parametersOkay = false
    } else if (!UUID_REGEX.test(buildId)) {
      this.context.stderr.write(renderInvalidBuildId(buildId))
      parametersOkay = false
    } else {
      // The backend stores the build ID as a UUID: send its canonical, lowercase form.
      this.buildId = buildId.toLowerCase()
    }

    return parametersOkay
  }
}

// Streamed, so that large libraries aren't loaded in memory.
const hashFile = async (path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
