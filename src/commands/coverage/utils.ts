import fs, {lstatSync} from 'fs'
import path from 'path'

import {XMLValidator} from 'fast-xml-parser'

import {renderFileReadError} from './renderer'

export const isFile = (filePath: string) => {
  try {
    return lstatSync(filePath).isFile()
  } catch (e) {
    return false
  }
}

export const validateCoverageReport = (
  filePath: string,
  format: string | undefined,
  userProvidedFormat: string | undefined
) => {
  if (format === undefined) {
    if (userProvidedFormat) {
      format = userProvidedFormat
    } else {
      return `Could not detect format of ${filePath}, please specify the format manually using the --format option`
    }
  } else {
    if (userProvidedFormat && format !== userProvidedFormat) {
      return `Detected format ${format} for ${filePath}, but user-provided format is ${userProvidedFormat}`
    }
  }

  if (format === 'jacoco') {
    const xmlFileContentString = String(fs.readFileSync(filePath))
    const validationOutput = XMLValidator.validate(xmlFileContentString)
    if (validationOutput !== true) {
      return validationOutput.err.msg
    }

    // TODO add Jacoco-specific validation to ensure this is a well-formed Jacoco report
  }

  return undefined
}

export const detectFormat = (filePath: string): 'jacoco' | undefined => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }
  if (path.extname(filePath).toLowerCase() !== '.xml') {
    return undefined
  }

  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(1024)
    fs.readSync(fd, buffer, 0, 1024, 0)
    const data = buffer.toString('utf8')

    if (data.includes('<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN"')) {
      return 'jacoco'
    }
  } catch (error) {
    renderFileReadError(filePath, error)
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd)
    }
  }

  return undefined
}
