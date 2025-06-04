import fs from 'fs'

import {XMLValidator} from 'fast-xml-parser'
import upath from 'upath'

import {getBaseUrl} from '../../helpers/app'
import {SpanTags} from '../../helpers/interfaces'
import {CI_JOB_URL, CI_PIPELINE_URL, GIT_REPOSITORY_URL, PR_NUMBER} from '../../helpers/tags'

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

  return `${getBaseUrl()}api/ui/code-coverage-api/redirect/pull-requests/${escapedPrNumber}?repository_url=${escapedRepoUrl}`
}
