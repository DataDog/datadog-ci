import fs from 'fs'

import {XMLValidator} from 'fast-xml-parser'
import upath from 'upath'

import {renderFileReadError} from './renderer'

const ROOT_TAG_REGEX = /<([^?!\s/>]+)/

export const validateCoverageReport = (filePath: string, format: string) => {
  if (format === 'jacoco') {
    const xmlFileContentString = String(fs.readFileSync(filePath))
    const validationOutput = XMLValidator.validate(xmlFileContentString)
    if (validationOutput !== true) {
      return validationOutput.err.msg
    }

    // Check that the root element is 'report' and that the report contains sourcefile tags
    const rootTagMatch = xmlFileContentString.match(ROOT_TAG_REGEX)
    if (!rootTagMatch || rootTagMatch[1] !== 'report') {
      return 'Invalid Jacoco report: root element must be <report>'
    }
    if (!xmlFileContentString.includes('<sourcefile')) {
      return 'Invalid Jacoco report: missing <sourcefile> tags'
    }
  }

  return undefined
}

export const detectFormat = (filePath: string): 'jacoco' | undefined => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }
  if (upath.extname(filePath).toLowerCase() !== '.xml') {
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
