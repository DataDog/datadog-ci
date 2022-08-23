import {Writable} from 'stream'
import {checkFile} from '../../helpers/validation'
import {Sourcemap} from './interfaces'
import {renderMinifiedPathPrefixMisusage} from './renderer'
import {extractRepeatedPath} from './utils'

export class InvalidPayload extends Error {
  public reason: string

  constructor(reason: string, message?: string) {
    super(message)
    this.reason = reason
  }
}

export const validatePayload = (sourcemap: Sourcemap, stdout: Writable) => {
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

  // Check that the folders part of the --minified-path-prefix flag are not present within the minifiedFilePath.
  if (sourcemap.minifiedPathPrefix) {
    const repeated = extractRepeatedPath(sourcemap.minifiedPathPrefix!, sourcemap.minifiedFilePath)
    if (repeated) {
      stdout.write(renderMinifiedPathPrefixMisusage(sourcemap, repeated))
    }
  }
}
