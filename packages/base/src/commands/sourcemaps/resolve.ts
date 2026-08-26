import fs from 'fs'

import type {SourcemapResolution} from './interfaces'

import {Command, Option} from 'clipanion'
import upath from 'upath'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'

import {extractDebugIdAsync} from './debugId'
import {findSourcemaps} from './findSourcemaps'
import {Sourcemap, SourcemapResolutionStatus} from './interfaces'
import {renderDiscoveryWarning, renderPathNotFound, renderSourcemapResolutions} from './renderer'

const DEBUG_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface SourcemapDebugIdResult {
  debugId?: string
  error?: string
}

const readSourcemapDebugId = async (sourcemapPath: string): Promise<SourcemapDebugIdResult> => {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(sourcemapPath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {error: 'sourcemap must be a JSON object'}
    }

    const debugId = (parsed as Record<string, unknown>).debug_id
    if (debugId === undefined) {
      return {}
    }
    if (typeof debugId !== 'string' || !DEBUG_ID_REGEX.test(debugId)) {
      return {error: 'sourcemap contains an invalid debug_id'}
    }

    return {debugId}
  } catch (error) {
    return {error: error instanceof Error ? error.message : String(error)}
  }
}

const getResolutionStatus = (
  bundleDebugId: string | undefined,
  sourcemapDebugId: string | undefined
): SourcemapResolutionStatus => {
  if (bundleDebugId && sourcemapDebugId) {
    return bundleDebugId.toLowerCase() === sourcemapDebugId.toLowerCase()
      ? SourcemapResolutionStatus.Matched
      : SourcemapResolutionStatus.Mismatched
  }
  if (bundleDebugId) {
    return SourcemapResolutionStatus.BundleOnly
  }
  if (sourcemapDebugId) {
    return SourcemapResolutionStatus.SourcemapOnly
  }

  return SourcemapResolutionStatus.Missing
}

export class SourcemapsResolveCommand extends BaseCommand {
  public static paths = [['sourcemaps', 'resolve']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Resolve debug IDs to local JavaScript bundles and sourcemaps.',
    details: `
      This read-only command finds local bundle-sourcemap pairs by debug ID or reports pairs whose runtime bundle has no debug ID.
    `,
    examples: [
      ['Resolve a debug ID', 'datadog-ci sourcemaps resolve ./dist --debug-id 12345678-1234-1234-1234-123456789abc'],
      ['Find bundles without debug IDs', 'datadog-ci sourcemaps resolve ./dist --missing-debug-id'],
      ['Return machine-readable output', 'datadog-ci sourcemaps resolve ./dist --missing-debug-id --json'],
    ],
  })

  private basePath = Option.String({required: true})
  private debugId = Option.String('--debug-id')
  private missingDebugId = Option.Boolean('--missing-debug-id', false)
  private json = Option.Boolean('--json', false)
  private maxConcurrency = Option.String('--max-concurrency', '20', {validator: validation.isInteger()})
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<number> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)
    this.basePath = upath.normalize(this.basePath)

    if (!this.validateOptions()) {
      return 1
    }
    if (!fs.existsSync(this.basePath)) {
      this.context.stderr.write(renderPathNotFound(this.basePath))

      return 1
    }
    if (!fs.statSync(this.basePath).isDirectory()) {
      this.context.stderr.write(`Path must be a directory: ${this.basePath}\n`)

      return 1
    }

    let discoveryFailures = 0
    const payloads = await findSourcemaps(
      this.basePath,
      this.maxConcurrency,
      (minifiedFilePath, sourcemapPath) => {
        const relativePath = upath.relative(this.basePath, minifiedFilePath)

        return new Sourcemap(minifiedFilePath, relativePath, sourcemapPath, relativePath)
      },
      (message) => {
        discoveryFailures++
        this.context.stderr.write(renderDiscoveryWarning(message))
      }
    )

    const resolutions = await doWithMaxConcurrency(this.maxConcurrency, payloads, (payload) =>
      this.resolvePayload(payload)
    )
    const matches = resolutions
      .filter((resolution) => this.matchesQuery(resolution))
      .sort((left, right) => left.minifiedFilePath.localeCompare(right.minifiedFilePath))

    this.context.stdout.write(
      this.json ? `${JSON.stringify(matches, undefined, 2)}\n` : renderSourcemapResolutions(matches)
    )

    if (this.debugId && matches.length === 0) {
      if (!this.json) {
        this.context.stdout.write(`No local sourcemap artifacts found for debug ID ${this.debugId}.\n`)
      }

      return 1
    }
    if (this.missingDebugId && matches.length === 0 && !this.json) {
      this.context.stdout.write('All discovered minified files contain a debug ID.\n')
    }

    return discoveryFailures === 0 ? 0 : 1
  }

  private validateOptions(): boolean {
    if ((this.debugId !== undefined) === this.missingDebugId) {
      this.context.stderr.write('Exactly one of --debug-id or --missing-debug-id must be provided.\n')

      return false
    }
    if (this.debugId && !DEBUG_ID_REGEX.test(this.debugId)) {
      this.context.stderr.write('--debug-id must be a UUID.\n')

      return false
    }

    return true
  }

  private async resolvePayload(payload: Sourcemap): Promise<SourcemapResolution> {
    const [bundleDebugId, sourcemapResult] = await Promise.all([
      extractDebugIdAsync(payload.minifiedFilePath),
      readSourcemapDebugId(payload.sourcemapPath),
    ])

    return {
      ...(bundleDebugId ? {bundleDebugId} : {}),
      minifiedFilePath: payload.minifiedFilePath,
      ...(sourcemapResult.debugId ? {sourcemapDebugId: sourcemapResult.debugId} : {}),
      ...(sourcemapResult.error ? {sourcemapError: sourcemapResult.error} : {}),
      sourcemapPath: payload.sourcemapPath,
      status: getResolutionStatus(bundleDebugId, sourcemapResult.debugId),
    }
  }

  private matchesQuery(resolution: SourcemapResolution): boolean {
    if (this.missingDebugId) {
      return resolution.bundleDebugId === undefined
    }

    const debugId = this.debugId!.toLowerCase()

    return resolution.bundleDebugId?.toLowerCase() === debugId || resolution.sourcemapDebugId?.toLowerCase() === debugId
  }
}
