import fs from 'fs'

import type {SourcemapDebugIdMatch} from './interfaces'

import {Command, Option} from 'clipanion'
import upath from 'upath'

import {BaseCommand} from '@datadog/datadog-ci-base'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {buildPath} from '@datadog/datadog-ci-base/helpers/utils'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'

import {isValidDebugId} from './debugId'
import {
  renderDiscoveryWarning,
  renderNoSourcemapsFound,
  renderPathNotFound,
  renderSourcemapDebugIdMatches,
} from './renderer'
import {extractSourcemapDebugId} from './sourcemapDebugId'

export class SourcemapsFindCommand extends BaseCommand {
  public static paths = [['sourcemaps', 'find']]

  public static usage = Command.Usage({
    category: 'RUM',
    description: 'Find local JavaScript sourcemaps by debug ID.',
    details: `
      This read-only command finds local sourcemaps by their top-level debug_id field or reports sourcemaps without one.
    `,
    examples: [
      ['Find a debug ID', 'datadog-ci sourcemaps find ./dist --debug-id 12345678-1234-1234-1234-123456789abc'],
      ['Find sourcemaps without debug IDs', 'datadog-ci sourcemaps find ./dist --missing-debug-id'],
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

    const sourcemapPaths = globSync(buildPath(this.basePath, '**/*.js.map'))
    if (sourcemapPaths.length === 0) {
      if (this.json) {
        this.context.stdout.write('[]\n')
      } else {
        this.context.stdout.write(renderNoSourcemapsFound(this.basePath))
      }

      return 1
    }

    const inspectedSourcemaps = await doWithMaxConcurrency(
      this.maxConcurrency,
      sourcemapPaths,
      async (sourcemapPath) => ({
        sourcemapPath,
        ...(await extractSourcemapDebugId(sourcemapPath)),
      })
    )
    let inspectionFailures = 0
    for (const sourcemap of inspectedSourcemaps) {
      if (sourcemap.error) {
        inspectionFailures++
        this.context.stderr.write(
          renderDiscoveryWarning(`Could not inspect sourcemap ${sourcemap.sourcemapPath}: ${sourcemap.error}`)
        )
      }
    }
    const matches: SourcemapDebugIdMatch[] = inspectedSourcemaps
      .filter(
        ({debugId, error}) =>
          error === undefined &&
          (this.missingDebugId ? debugId === undefined : debugId?.toLowerCase() === this.debugId!.toLowerCase())
      )
      .map(({debugId, sourcemapPath}) => ({...(debugId ? {debugId} : {}), sourcemapPath}))
      .sort((left, right) => left.sourcemapPath.localeCompare(right.sourcemapPath))

    this.context.stdout.write(
      this.json ? `${JSON.stringify(matches, undefined, 2)}\n` : renderSourcemapDebugIdMatches(matches)
    )

    if (this.debugId && matches.length === 0) {
      if (!this.json) {
        this.context.stdout.write(`No local sourcemap artifacts found for debug ID ${this.debugId}.\n`)
      }

      return 1
    }
    if (this.missingDebugId && matches.length === 0 && inspectionFailures === 0 && !this.json) {
      this.context.stdout.write('All discovered sourcemaps contain a debug ID.\n')
    }

    return inspectionFailures === 0 ? 0 : 1
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
}
