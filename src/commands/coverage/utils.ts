import fs from 'fs'

import {XMLValidator} from 'fast-xml-parser'
import upath from 'upath'

import {getBaseUrl} from '../../helpers/app'
import {SpanTags} from '../../helpers/interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_REPOSITORY_URL, PR_NUMBER} from '../../helpers/tags'

import {renderFileReadError} from './renderer'

const ROOT_TAG_REGEX = /<([^?!\s/>]+)/

export const jacocoFormat = 'jacoco' as const
export const lcovFormat = 'lcov' as const
export const opencoverFormat = 'opencover' as const

export const coverageFormats = [jacocoFormat, lcovFormat, opencoverFormat] as const
export type CoverageFormat = typeof coverageFormats[number]

export const isCoverageFormat = (value: string): value is CoverageFormat => {
  return (coverageFormats as readonly string[]).includes(value)
}

export const toCoverageFormat = (value: string | undefined): CoverageFormat | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (isCoverageFormat(value)) {
    return value
  }
  throw new Error(`Invalid coverage format: ${value}`)
}

export const detectFormat = (filePath: string): CoverageFormat | undefined => {
  if (!fs.existsSync(filePath)) {
    return undefined
  }

  const lowercaseFile = filePath.toLowerCase()
  const filename = upath.basename(lowercaseFile)
  const extension = upath.extname(lowercaseFile)

  if (extension === '.xml' && (filename.includes('coverage') || filename.includes('jacoco'))) {
    return readFirstKb(filePath, (data) => {
      if (data.includes('<CoverageSession')) {
        return opencoverFormat
      } else if (data.includes('<!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN"') || data.includes('<report')) {
        return jacocoFormat
      }
    })
  } else if (
    extension === '.lcov' ||
    extension === '.lcov.info' ||
    extension === '.lcov-report.info' ||
    filename === 'lcov.info' ||
    filename === 'lcov-report.info' ||
    filename === 'lcov.dat'
  ) {
    return readFirstKb(filePath, (data) => {
      return data.startsWith('TN:') || data.startsWith('SF:') ? lcovFormat : undefined
    })
  }

  return undefined
}

const readFirstKb = (
  filePath: string,
  action: (data: string) => CoverageFormat | undefined
): CoverageFormat | undefined => {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(1024)
    fs.readSync(fd, buffer, 0, 1024, 0)
    const data = buffer.toString('utf8')

    return action(data)
  } catch (error) {
    renderFileReadError(filePath, error)

    return undefined
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd)
    }
  }
}

export const validateCoverageReport = (filePath: string, format: CoverageFormat) => {
  if (format === jacocoFormat) {
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

  if (format === opencoverFormat) {
    const xmlFileContentString = String(fs.readFileSync(filePath))
    const validationOutput = XMLValidator.validate(xmlFileContentString)
    if (validationOutput !== true) {
      return validationOutput.err.msg
    }

    // Check that the root element is 'CoverageSession'
    const rootTagMatch = xmlFileContentString.match(ROOT_TAG_REGEX)
    if (!rootTagMatch || rootTagMatch[1] !== 'CoverageSession') {
      return 'Invalid Opencover report: root element must be <CoverageSession>'
    }
  }

  if (format === lcovFormat) {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.startsWith('TN:') || content.startsWith('SF:')) {
      return 'Invalid LCOV report: must start with TN: or SF:'
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
    const hasData = lines.some((line) => line.startsWith('DA:'))
    if (!hasData) {
      return 'Invalid LCOV report: missing DA: lines'
    }

    const endsCorrectly = lines[lines.length - 1] === 'end_of_record'
    if (!endsCorrectly) {
      return 'Invalid LCOV report: does not end with "end_of_record"'
    }
  }

  return undefined
}

export const getCoverageDetailsUrl = (spanTags: SpanTags): string => {
  const repoUrl = spanTags[GIT_REPOSITORY_URL]
  if (!repoUrl) {
    return ''
  }

  const prNumber = spanTags[PR_NUMBER]
  if (!prNumber) {
    return ''
  }

  const escapedPrNumber = encodeURIComponent(prNumber)
  const escapedRepoUrl = encodeURIComponent(repoUrl)

  return `${getBaseUrl()}api/ui/code-coverage/redirect/pull-requests/${escapedPrNumber}?repository_url=${escapedRepoUrl}`
}
