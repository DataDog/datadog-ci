import type {Sourcemap} from './interfaces'

import upath from 'upath'

import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {buildPath} from '@datadog/datadog-ci-base/helpers/utils'

import {getMinifiedFilePath, readLastLine} from './utils'

type CreateSourcemap = (minifiedFilePath: string, sourcemapPath: string) => Sourcemap
type ReportDiscoveryWarning = (message: string) => void

export const findSourcemaps = async (
  basePath: string,
  maxConcurrency: number,
  createSourcemap: CreateSourcemap,
  reportError?: ReportDiscoveryWarning
): Promise<Sourcemap[]> => {
  const jsFiles = globSync(buildPath(basePath, '**/*.js'))
  const resolvedBasePath = upath.resolve(basePath)
  let foundSourceMappingUrl = false

  const sourcemaps = (
    await doWithMaxConcurrency(maxConcurrency, jsFiles, async (minifiedFilePath) => {
      let lastLine: string
      try {
        lastLine = await readLastLine(minifiedFilePath)
      } catch {
        return undefined
      }
      const sourceMappingMatch = lastLine.match(/\/\/# sourceMappingURL=(.+\.map)/)

      if (sourceMappingMatch) {
        let sourcemapUrl: string
        try {
          // Next.js/Turbopack uses URL-percent encoding.
          sourcemapUrl = decodeURIComponent(sourceMappingMatch[1].trim())
        } catch {
          return undefined
        }

        // Remote and absolute paths cannot be resolved to local files.
        if (sourcemapUrl.includes('://') || upath.isAbsolute(sourcemapUrl)) {
          return undefined
        }

        foundSourceMappingUrl = true
        const sourcemapPath = upath.join(upath.dirname(minifiedFilePath), sourcemapUrl)
        const relativeSourcemapPath = upath.relative(resolvedBasePath, upath.resolve(sourcemapPath))
        if (
          relativeSourcemapPath === '..' ||
          relativeSourcemapPath.startsWith('../') ||
          upath.isAbsolute(relativeSourcemapPath)
        ) {
          reportError?.(
            `Ignoring sourcemap reference from ${minifiedFilePath} because ${sourcemapUrl} resolves outside ${basePath}`
          )

          return undefined
        }

        return createSourcemap(minifiedFilePath, sourcemapPath)
      }

      return undefined
    })
  ).filter((sourcemap): sourcemap is Sourcemap => sourcemap !== undefined)

  if (sourcemaps.length > 0 || foundSourceMappingUrl) {
    return sourcemaps
  }

  // Preserve the legacy convention when bundles do not contain sourceMappingURL.
  return globSync(buildPath(basePath, '**/*js.map')).map((sourcemapPath) =>
    createSourcemap(getMinifiedFilePath(sourcemapPath), sourcemapPath)
  )
}
