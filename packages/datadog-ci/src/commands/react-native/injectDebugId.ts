import {createHash} from 'crypto'
import {existsSync, promises} from 'fs'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {Command, Option} from 'clipanion'
import upath from 'upath'

/**
 * The Debug ID is injected in the bundle as a plain string, using this prefix.
 */
const DEBUG_ID_METADATA_PREFIX = 'datadog-debug-id-'

export class ReactNativeInjectDebugIdCommand extends Command {
  public static paths = [['react-native', 'inject-debug-id']]
  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Inject Debug ID into JavaScript bundles and sourcemaps.',
    details: `
        This command scans the specified directory for minified JavaScript bundles (.bundle) and their associated source maps (.map),
        injecting a unique Debug ID into each file. These Debug IDs enable precise source map resolution in Datadog, ensuring accurate 
        stack traces and error symbolication.
    `,
    examples: [
      ['Inject Debug ID', 'datadog-ci react-native inject-debug-id ./dist'],
      ['Inject Debug ID (dry run)', 'datadog-ci react-native inject-debug-id ./dist --dry-run'],
    ],
  })

  private assetsPath = Option.String({required: false})
  private dryRun = Option.Boolean('--dry-run', false)
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    if (!this.assetsPath) {
      this.context.stderr.write('[ERROR] No path specified for JS bundle and sourcemap.\n')

      return 1
    }

    if (!existsSync(this.assetsPath)) {
      this.context.stderr.write('[ERROR] The given path does not exist.\n')

      return 1
    }

    return this.injectDebugIds(this.assetsPath, this.dryRun)
  }

  /**
   * Scans the directory for bundles and sourcemaps, then injects Debug IDs.
   *
   * @param directory - The directory containing JavaScript bundles and sourcemaps.
   * @param dryRun - If true, does not modify files.
   */
  private async injectDebugIds(directory: string, dryRun: boolean): Promise<number> {
    this.context.stdout.write(`Scanning directory: ${directory}\n`)

    const files = await promises.readdir(directory)
    const bundles = files.filter((file) => file.endsWith('.bundle'))

    if (bundles.length === 0) {
      this.context.stderr.write(
        `[ERROR] JS bundle not found in "${directory}". Ensure your files follow the "*.bundle" and "*.bundle.map" naming convention.\n`
      )

      return 1
    }

    for (const bundle of bundles) {
      const bundlePath = upath.join(directory, bundle)
      const sourcemapPath = upath.join(directory, `${bundle}.map`)

      let debugId =
        (await this.extractDebugIdFromBundle(bundlePath)) || (await this.extractDebugIdFromSourceMap(sourcemapPath))

      if (!debugId) {
        const bundleData = await promises.readFile(bundlePath, 'utf-8')
        debugId = generateDebugId(bundleData)
        this.context.stdout.write(`Generated Debug ID for ${bundle}: ${debugId}\n`)
      } else {
        this.context.stdout.write(`Found existing Debug ID for ${bundle}: ${debugId}\n`)
      }

      if (!dryRun) {
        if (!(await this.injectDebugIdIntoBundle(bundlePath, debugId))) {
          return 1
        }

        if (existsSync(sourcemapPath)) {
          if (!(await this.injectDebugIdIntoSourceMap(sourcemapPath, debugId))) {
            return 1
          }

          this.context.stdout.write(`Updated Debug ID in ${bundle} and its sourcemap.\n`)
        }
      } else {
        this.context.stdout.write(`Dry run: No files modified.\n`)
      }
    }

    return 0
  }

  /**
   * Modifies the JS bundle by injecting a minified code snippet to allow runtime consumption of the given Debug ID,
   * and it appends it to the end of the file, while preserving mappings.
   *
   * - Appends a **code snippet** containing the Debug ID.
   * - Adds a **comment** with `//# debugId=<debug_id>`.
   * - Moves the last `//# sourceMappingURL=` or `//@ sourceMappingURL=` comment to the end.
   *
   * @param filePath - The path to the JavaScript file.
   * @param debugId - The Debug ID to inject.
   */
  private async injectDebugIdIntoBundle(filePath: string, debugId: string): Promise<boolean> {
    try {
      const jsContents = await promises.readFile(filePath, 'utf-8')
      const lines = jsContents.split('\n')

      // Find the last source mapping comment (`//# sourceMappingURL=...` or `//@ sourceMappingURL=...`)
      const sourcemapIndex = lines
        .map((line, index) => ({line, index}))
        .reverse()
        .find(({line}) => line.startsWith('//# sourceMappingURL=') || line.startsWith('//@ sourceMappingURL='))

      let sourcemapComment = ''
      if (sourcemapIndex) {
        // Remove the sourcemap comment so we can place it at the very end later
        sourcemapComment = lines.splice(sourcemapIndex.index, 1)[0]
      }

      // Inject Debug ID snippet (modify as needed)
      const snippet = createDebugIdSnippet(debugId)

      // Append minified snippet to the bundle
      lines.push(snippet)

      // Re-add the sourcemap comment at the end (if it was found)
      if (sourcemapComment) {
        lines.push(sourcemapComment)
      }

      // Append Debug ID comment
      lines.push(`//# debugId=${debugId}`)

      // Write back the modified contents
      await promises.writeFile(filePath, lines.join('\n'), 'utf-8')
      this.context.stdout.write(`✅ Debug ID injected into ${filePath}\n`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.context.stderr.write(`❌ Failed to inject Debug ID into ${filePath}:${errorMsg}\n`)

      return false
    }

    return true
  }

  /**
   * Injects a Debug ID into a sourcemap JSON file.
   */
  private async injectDebugIdIntoSourceMap(sourceMapPath: string, debugId: string): Promise<boolean> {
    let sourcemapData: string
    try {
      sourcemapData = await promises.readFile(sourceMapPath, 'utf-8')
    } catch (error) {
      this.context.stderr.write(`[ERROR] Cannot read sourcemap from ${sourceMapPath}: ${String(error)}\n`)

      return false
    }

    let content: Record<string, any>
    try {
      content = JSON.parse(sourcemapData) as Record<string, any>
    } catch (error) {
      this.context.stderr.write(`[ERROR] Cannot parse JSON from sourcemap at ${sourceMapPath}: ${String(error)}\n`)

      return false
    }

    content.debugId = debugId
    try {
      await promises.writeFile(sourceMapPath, JSON.stringify(content, undefined, 2))
    } catch (error) {
      this.context.stderr.write(`[ERROR] Cannot write sourcemap file at ${sourceMapPath}: ${String(error)}\n`)

      return false
    }

    return true
  }

  /**
   * Reads the Debug ID from a JavaScript bundle, if present.
   */
  private async extractDebugIdFromBundle(bundlePath: string): Promise<string | undefined> {
    const content = await promises.readFile(bundlePath, 'utf-8')
    const match = content.match(/\/\/# debugId=([a-f0-9-]+)/)

    return match ? match[1] : undefined
  }

  /**
   * Reads the Debug ID from a sourcemap file.
   */
  private async extractDebugIdFromSourceMap(sourceMapPath: string): Promise<string | undefined> {
    let sourcemapData: string
    try {
      sourcemapData = await promises.readFile(sourceMapPath, 'utf-8')
    } catch (error) {
      throw new Error(`Cannot read sourcemap from ${sourceMapPath}: ${String(error)}`)
    }

    let content: Record<string, any>
    try {
      content = JSON.parse(sourcemapData) as Record<string, any>
    } catch (error) {
      throw new Error(`Cannot parse JSON from sourcemap at ${sourceMapPath}: ${String(error)}`)
    }

    return (content.debugId as string) || undefined
  }
}

/**
 * Creates a minified JavaScript snippet that exposes the provided Debug ID
 * on the global scope at runtime.
 *
 * @param debugId - The Debug ID to be injected into the global scope.
 * @returns A minified JavaScript string that performs the injection.
 */
const createDebugIdSnippet = (debugId: string) => {
  return `var _datadogDebugIds,_datadogDebugIdMeta;void 0===_datadogDebugIds&&(_datadogDebugIds={});try{var stack=(new Error).stack;stack&&(_datadogDebugIds[stack]="${debugId}",_datadogDebugIdMeta="${DEBUG_ID_METADATA_PREFIX}${debugId}")}catch(e){}`
}

/**
 * Converts a string into a UUID (Version 4 format) based on its MD5 hash.
 *
 * @param str - The input string to convert into a UUID.
 * @returns A UUIDv4 string derived from the MD5 hash of the input.
 */
const generateDebugId = (str: string): string => {
  const md5sum = createHash('md5')
  md5sum.update(str)
  const md5Hash = md5sum.digest('hex')

  // Select a variant character (RFC 4122) - '8', '9', 'a', or 'b'
  const v4variant = ['8', '9', 'a', 'b'][md5Hash.charCodeAt(16) % 4]

  return `${md5Hash.substring(0, 8)}-${md5Hash.substring(8, 12)}-4${md5Hash.substring(
    13,
    16
  )}-${v4variant}${md5Hash.substring(17, 20)}-${md5Hash.substring(20)}`.toLowerCase()
}
