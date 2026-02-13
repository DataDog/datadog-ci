import fs from 'fs'

import {getBaseUrl} from '@datadog/datadog-ci-base/helpers/app'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {GIT_REPOSITORY_URL, PR_NUMBER} from '@datadog/datadog-ci-base/helpers/tags'
import {XMLValidator} from 'fast-xml-parser'
import upath from 'upath'

import {renderFileReadError} from './renderer'

const ROOT_TAG_REGEX = /<([^?!\s/>]+)/

export const jacocoFormat = 'jacoco' as const
export const lcovFormat = 'lcov' as const
export const opencoverFormat = 'opencover' as const
export const coberturaFormat = 'cobertura' as const
export const simplecovFormat = 'simplecov' as const
export const simplecovInternalFormat = 'simplecov-internal' as const
export const cloverFormat = 'clover' as const
export const goCoverprofileFormat = 'go-coverprofile' as const

export const coverageFormats = [
  jacocoFormat,
  lcovFormat,
  opencoverFormat,
  coberturaFormat,
  simplecovFormat,
  simplecovInternalFormat,
  cloverFormat,
  goCoverprofileFormat,
] as const
export type CoverageFormat = (typeof coverageFormats)[number]

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

  if (
    extension === '.xml' &&
    (filename.includes('coverage') ||
      filename.includes('jacoco') ||
      filename.includes('cobertura') ||
      filename.includes('clover'))
  ) {
    return readFirstKb(filePath, (data) => detectXmlCoverageFormat(data, true))
  } else if (extension === '.json' && filename.includes('coverage')) {
    return readFirstKb(filePath, detectSimplecovFormat)
  } else if (filename === '.resultset.json') {
    return readFirstKb(filePath, detectSimplecovInternalFormat)
  } else if (
    extension === '.lcov' ||
    extension === '.lcov.info' ||
    extension === '.lcov-report.info' ||
    filename === 'lcov.info' ||
    filename === 'lcov-report.info' ||
    filename === 'lcov.dat'
  ) {
    return readFirstKb(filePath, detectLcovFormat)
  } else if (extension === '.out' || filename.includes('coverage')) {
    return readFirstKb(filePath, detectGoCoverprofileFormat)
  }

  // Fallback content sniffing for non-standard filenames (for example, "cover.profile").
  return readFirstKb(filePath, detectCoverageFormatByContent)
}

const isGoCoverprofileContent = (data: string): boolean =>
  data.startsWith('mode: set') || data.startsWith('mode: count') || data.startsWith('mode: atomic')

const isLcovContent = (data: string): boolean => data.startsWith('TN:') || data.startsWith('SF:')

const detectGoCoverprofileFormat = (data: string): CoverageFormat | undefined => {
  return isGoCoverprofileContent(data) ? goCoverprofileFormat : undefined
}

const detectLcovFormat = (data: string): CoverageFormat | undefined => {
  return isLcovContent(data) ? lcovFormat : undefined
}

const detectSimplecovFormat = (data: string): CoverageFormat | undefined => {
  return data.includes('simplecov_version') ? simplecovFormat : undefined
}

const detectSimplecovInternalFormat = (data: string): CoverageFormat | undefined => {
  return data.includes('coverage') && data.includes('lines') ? simplecovInternalFormat : undefined
}

const detectXmlCoverageFormat = (data: string, allowLooseJacocoMatch: boolean): CoverageFormat | undefined => {
  if (data.includes('<CoverageSession')) {
    return opencoverFormat
  }

  if (
    (data.includes('<!DOCTYPE coverage') && data.includes('cobertura.sourceforge.net/xml/coverage')) ||
    (data.includes('<coverage') && data.includes('line-rate='))
  ) {
    return coberturaFormat
  }

  if (
    (data.includes('<!DOCTYPE report') && data.includes('-//JACOCO//DTD Report')) ||
    (allowLooseJacocoMatch && data.includes('<report'))
  ) {
    return jacocoFormat
  }

  if (data.includes('<coverage') && data.includes('<project')) {
    return cloverFormat
  }

  return undefined
}

const detectCoverageFormatByContent = (data: string): CoverageFormat | undefined => {
  return (
    detectGoCoverprofileFormat(data) ||
    detectLcovFormat(data) ||
    detectXmlCoverageFormat(data, false) ||
    detectSimplecovFormat(data)
  )
}

const readFirstKb = (
  filePath: string,
  action: (data: string) => CoverageFormat | undefined
): CoverageFormat | undefined => {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(1024)
    const bytesRead = fs.readSync(fd, buffer, 0, 1024, 0)
    const data = buffer.toString('utf8', 0, bytesRead)

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

  if (format === coberturaFormat) {
    const xmlFileContentString = String(fs.readFileSync(filePath))
    const validationOutput = XMLValidator.validate(xmlFileContentString)
    if (validationOutput !== true) {
      return validationOutput.err.msg
    }

    // Check that the root element is 'coverage'
    const rootTagMatch = xmlFileContentString.match(ROOT_TAG_REGEX)
    if (!rootTagMatch || rootTagMatch[1] !== 'coverage') {
      return 'Invalid Cobertura report: root element must be <coverage>'
    }
  }

  if (format === cloverFormat) {
    const xmlFileContentString = String(fs.readFileSync(filePath))
    const validationOutput = XMLValidator.validate(xmlFileContentString)
    if (validationOutput !== true) {
      return validationOutput.err.msg
    }

    // Check that the root element is 'coverage'
    const rootTagMatch = xmlFileContentString.match(ROOT_TAG_REGEX)
    if (!rootTagMatch || rootTagMatch[1] !== 'coverage') {
      return 'Invalid Clover report: root element must be <coverage>'
    }
  }

  if (format === simplecovFormat) {
    try {
      const jsonContent = String(fs.readFileSync(filePath))
      const simplecovReport = JSON.parse(jsonContent) as Record<string, unknown>
      if (!simplecovReport['coverage']) {
        return `Invalid simplecov report: missing "meta" or "coverage" top-level fields`
      }
      for (const [fileName, fileCoverage] of Object.entries(simplecovReport['coverage'])) {
        if (!fileCoverage['lines']) {
          return `Invalid simplecov report: file ${fileName} is missing "lines" field`
        }
      }
    } catch (err) {
      return `Invalid simplecov report: could not parse JSON: ${err}`
    }
  }

  if (format === simplecovInternalFormat) {
    try {
      const jsonContent = String(fs.readFileSync(filePath))
      const simplecovInternalReport = JSON.parse(jsonContent) as Record<string, unknown>
      for (const [specName, s] of Object.entries(simplecovInternalReport)) {
        const spec = s as Record<string, unknown>
        if (!spec['coverage']) {
          return `Invalid internal simplecov report: spec ${specName} is missing "coverage" field`
        }
        for (const [fileName, fileCoverage] of Object.entries(spec['coverage'])) {
          if (!fileCoverage['lines']) {
            return `Invalid internal simplecov report: file ${fileName} is missing "lines" field`
          }
        }
      }
    } catch (err) {
      return `Invalid internal simplecov report: could not parse JSON: ${err}`
    }
  }

  if (format === lcovFormat) {
    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.startsWith('TN:') && !content.startsWith('SF:')) {
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

  if (format === goCoverprofileFormat) {
    const content = fs.readFileSync(filePath, 'utf8')
    const hasCorrectMode =
      content.startsWith('mode: set') || content.startsWith('mode: count') || content.startsWith('mode: atomic')
    if (!hasCorrectMode) {
      return 'Invalid Go coverage report: must start with "mode: set|count|atomic"'
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
