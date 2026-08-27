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

import {extractDebugIdAsync, isValidDebugId} from './debugId'
import {findSourcemaps} from './findSourcemaps'
import {Sourcemap, SourcemapResolutionStatus} from './interfaces'
import {renderDiscoveryWarning, renderPathNotFound, renderSourcemapResolutions} from './renderer'
import {extractSourcemapDebugId} from './sourcemapDebugId'

const getResolutionStatus = (
  bundleDebugId: string | undefined,
  sourcemapDebugId: string | undefined,
  bundleError: string | undefined
): SourcemapResolutionStatus => {
  if (bundleError) {
    return SourcemapResolutionStatus.Error
  }
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

export class SourcemapsFindCommand extends BaseCommand {
  public static paths = [['sourcemaps', 'find']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Find local JavaScript bundles and sourcemaps by debug ID.',
    details: `
      This read-only command finds local bundle-sourcemap pairs by debug ID or reports pairs whose runtime bundle has no debug ID.
    `,
    examples: [
      ['Find a debug ID', 'datadog-ci sourcemaps find ./dist --debug-id 12345678-1234-1234-1234-123456789abc'],
      ['Find bundles without debug IDs', 'datadog-ci sourcemaps find ./dist --missing-debug-id'],
      ['Return machine-readable output', 'datadog-ci sourcemaps find ./dist --missing-debug-id --json'],
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
    let resolutionFailures = 0
    for (const resolution of resolutions) {
      if (resolution.bundleError) {
        resolutionFailures++
        this.context.stderr.write(
          renderDiscoveryWarning(`Could not inspect bundle ${resolution.minifiedFilePath}: ${resolution.bundleError}`)
        )
      }
    }
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
    if (this.missingDebugId && matches.length === 0 && resolutionFailures === 0 && !this.json) {
      this.context.stdout.write('All discovered minified files contain a debug ID.\n')
    }

    return discoveryFailures === 0 && resolutionFailures === 0 ? 0 : 1
  }

  private validateOptions(): boolean {
    if ((this.debugId !== undefined) === this.missingDebugId) {
      this.context.stderr.write('Exactly one of --debug-id or --missing-debug-id must be provided.\n')

      return false
    }
    if (this.debugId && !isValidDebugId(this.debugId)) {
      this.context.stderr.write('--debug-id must be a UUID.\n')

      return false
    }

    return true
  }

  private async resolvePayload(payload: Sourcemap): Promise<SourcemapResolution> {
    const [bundleResult, sourcemapResult] = await Promise.all([
      extractDebugIdAsync(payload.minifiedFilePath),
      extractSourcemapDebugId(payload.sourcemapPath),
    ])

    return {
      ...(bundleResult.debugId ? {bundleDebugId: bundleResult.debugId} : {}),
      ...(bundleResult.error ? {bundleError: bundleResult.error} : {}),
      minifiedFilePath: payload.minifiedFilePath,
      ...(sourcemapResult.debugId ? {sourcemapDebugId: sourcemapResult.debugId} : {}),
      ...(sourcemapResult.error ? {sourcemapError: sourcemapResult.error} : {}),
      sourcemapPath: payload.sourcemapPath,
      status: getResolutionStatus(bundleResult.debugId, sourcemapResult.debugId, bundleResult.error),
    }
  }

  private matchesQuery(resolution: SourcemapResolution): boolean {
    if (this.missingDebugId) {
      return resolution.bundleDebugId === undefined && resolution.bundleError === undefined
    }

    const debugId = this.debugId!.toLowerCase()

    return resolution.bundleDebugId?.toLowerCase() === debugId || resolution.sourcemapDebugId?.toLowerCase() === debugId
  }
}
