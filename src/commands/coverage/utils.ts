import fs, {lstatSync} from 'fs'
import path from 'path'

import {XMLValidator} from 'fast-xml-parser'

export const isFile = (filePath: string) => {
  try {
    return lstatSync(filePath).isFile()
  } catch (e) {
    return false
  }
}

export const validateCoverageReport = async (
  filePath: string,
  format: string | undefined,
  userProvidedFormat: string | undefined
) => {
  if (format === undefined) {
    if (userProvidedFormat) {
      format = userProvidedFormat
    } else {
      return 'Could not detect format of ' + filePath + ', please specify the format manually using the --format option'
    }
  } else {
    if (userProvidedFormat && format !== userProvidedFormat) {
      return 'Detected format ' + format + ' for ' + filePath + ', but user-provided format is ' + userProvidedFormat
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

export const detectFormat = (filePath: string): Promise<'jacoco' | undefined> => {
  if (!fs.existsSync(filePath)) {
    return Promise.resolve(undefined)
  }
  if (path.extname(filePath).toLowerCase() !== '.xml') {
    return Promise.resolve(undefined)
  }

  const stream = fs.createReadStream(filePath, {encoding: 'utf8', start: 0, end: 1024})
  let data = ''

  return new Promise<'jacoco' | undefined>((resolve) => {
    stream.on('data', (chunk) => {
      data += chunk
      if (data.includes('<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN"')) {
        stream.close()
        resolve('jacoco')
      }
    })
    stream.on('end', () => {
      resolve(undefined)
    })
    stream.on('error', () => {
      resolve(undefined)
    })
  })
}
