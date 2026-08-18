import type {Sourcemap} from './interfaces'

import upath from 'upath'

import {doWithMaxConcurrency} from '@datadog/datadog-ci-base/helpers/concurrency'
import {globSync} from '@datadog/datadog-ci-base/helpers/glob'
import {buildPath} from '@datadog/datadog-ci-base/helpers/utils'

import {getMinifiedFilePath, readLastLine} from './utils'

type CreateSourcemap = (minifiedFilePath: string, sourcemapPath: string) => Sourcemap

export const findSourcemaps = async (
  basePath: string,
  maxConcurrency: number,
  createSourcemap: CreateSourcemap
): Promise<Sourcemap[]> => {
  const jsFiles = globSync(buildPath(basePath, '**/*.js'))

  const sourcemaps = (
    await doWithMaxConcurrency(maxConcurrency, jsFiles, async (minifiedFilePath) => {
      try {
        const lastLine = await readLastLine(minifiedFilePath)
        const sourceMappingMatch = lastLine.match(/\/\/# sourceMappingURL=(.+\.map)/)

        if (sourceMappingMatch) {
          // Next.js/Turbopack uses URL-percent encoding.
          const sourcemapUrl = decodeURIComponent(sourceMappingMatch[1].trim())

          // Remote and absolute paths cannot be resolved to local files.
          if (sourcemapUrl.includes('://') || upath.isAbsolute(sourcemapUrl)) {
            return undefined
          }

          return createSourcemap(minifiedFilePath, upath.join(upath.dirname(minifiedFilePath), sourcemapUrl))
        }
      } catch {
        return undefined
      }

      return undefined
    })
  ).filter((sourcemap): sourcemap is Sourcemap => sourcemap !== undefined)

  if (sourcemaps.length > 0) {
    return sourcemaps
  }

  // Preserve the legacy convention when bundles do not contain sourceMappingURL.
  return globSync(buildPath(basePath, '**/*js.map')).map((sourcemapPath) =>
    createSourcemap(getMinifiedFilePath(sourcemapPath), sourcemapPath)
  )
}
