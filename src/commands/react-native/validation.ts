import {checkFile} from '../../helpers/validation'
import {RNSourcemap} from './interfaces'

export class InvalidPayload extends Error {
  public reason: string

  constructor(reason: string, message?: string) {
    super(message)
    this.reason = reason
  }
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
