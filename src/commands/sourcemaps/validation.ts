import fs from 'fs'
import {Sourcemap} from './interfaces'

export class InvalidPayload extends Error {
  public reason: string

  constructor(reason: string, message?: string) {
    super(message)
    this.reason = reason
  }
}

const checkFile: (path: string) => {empty: boolean; exists: boolean} = (path: string) => {
  try {
    const stats = fs.statSync(path)
    if (stats.size === 0) {
      return {exists: true, empty: true}
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {exists: false, empty: false}
    }
    // Other kind of error
    throw error
  }

  return {exists: true, empty: false}
}

export const validatePayload = (sourcemap: Sourcemap) => {
  // Check existence of sourcemap file
  const sourcemapCheck = checkFile(sourcemap.sourcemapPath)
  if (!sourcemapCheck.exists) {
    // This case should not happen as all collected sourcemaps should point to correct files
    throw new InvalidPayload('missing_sourcemap', `Skipping missing sourcemap (${sourcemap.sourcemapPath})`)
  }
  if (sourcemapCheck.empty) {
    throw new InvalidPayload('empty_sourcemap', `Skipping empty sourcemap (${sourcemap.sourcemapPath})`)
  }
  // Check existence of minified file
  const minifiedFileCheck = checkFile(sourcemap.minifiedFilePath)
  if (!minifiedFileCheck.exists) {
    throw new InvalidPayload(
      'missing_js',
      `Missing corresponding JS file for sourcemap (${sourcemap.minifiedFilePath})`
    )
  }
  if (minifiedFileCheck.empty) {
    throw new InvalidPayload(
      'empty_js',
      `Skipping sourcemap (${sourcemap.sourcemapPath}) due to ${sourcemap.minifiedFilePath} being empty`
    )
  }
}
