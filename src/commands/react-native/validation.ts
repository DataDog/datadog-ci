import fs from 'fs'
import {RNSourcemap} from './interfaces'

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

export const validatePayload = (sourcemap: RNSourcemap) => {
  // Check existence of sourcemap file
  const sourcemapCheck = checkFile(sourcemap.sourcemapPath)
  if (!sourcemapCheck.exists) {
    // This case should not happen as all collected sourcemaps should point to correct files
    throw new InvalidPayload('missing_sourcemap', `Skipping missing sourcemap (${sourcemap.sourcemapPath})`)
  }
  if (sourcemapCheck.empty) {
    throw new InvalidPayload('empty_sourcemap', `Skipping empty sourcemap (${sourcemap.sourcemapPath})`)
  }
  // Check existence of bundle file
  const bundleCheck = checkFile(sourcemap.bundlePath)
  if (!bundleCheck.exists) {
    throw new InvalidPayload('missing_js', `Missing corresponding JS file for sourcemap (${sourcemap.bundlePath})`)
  }
  if (bundleCheck.empty) {
    throw new InvalidPayload(
      'empty_js',
      `Skipping sourcemap (${sourcemap.sourcemapPath}) due to ${sourcemap.bundlePath} being empty`
    )
  }
}
