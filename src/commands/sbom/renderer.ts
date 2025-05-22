import chalk from 'chalk'

import {getBaseUrl} from '../junit/utils'

import {Dependency, ScaRequest} from './types'
import {validateDependencyName} from './validation'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export const renderInvalidFile = (sbomReport: string) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`

  let fullStr = ''
  fullStr += chalk.red(`${ICONS.FAILED} Invalid SBOM report file ${reportPath}.\n`)
  fullStr += chalk.red(`The report is not a valid SBOM or is not compliant with our json schema.\n`)

  return fullStr
}

export const renderInvalidPayload = (sbomReport: string) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`
  let fullStr = ''
  fullStr += chalk.red(`Cannot generate payload for file ${reportPath}.\n`)
  fullStr += chalk.red(`Make sure you run the command inside a git repository and the SBOM file is valid\n`)

  return fullStr
}

export const renderDuplicateUpload = (sha: string, env: string, service: string) => {
  let fullStr = ''
  fullStr += chalk.red(`${ICONS.WARNING}  Duplicate SBOM upload detected\n`)
  fullStr += chalk.red(`An analysis has already been processed for sha:${sha} env:${env} service:${service}\n`)
  fullStr += chalk.red(`Push a new commit or specify a different env or service variable\n`)
  fullStr += chalk.red(`Exiting with code 0\n`)

  return fullStr
}

export const renderNoDefaultBranch = (repositoryUrl: string) => {
  let fullStr = ''

  fullStr += chalk.red(`${ICONS.WARNING}  Failed to infer the default branch for ${repositoryUrl}\n`)
  fullStr += chalk.red(`To resolve this, do one of the following:\n`)
  fullStr += chalk.red(` - Upload from your default branch first (must be one of: master, main, default, stable, source, prod, or develop)\n`)
  fullStr += chalk.red(` - Or visit ${getBaseUrl()}source-code/repositories to manually override the default branch for this repository\n`)
  fullStr += chalk.red(`After completing either step, you can retry uploading the SBOM from this branch\n`)

  return fullStr
}

export const renderFailedUpload = (sbomReport: string, error: any) => {
  const reportPath = `[${chalk.bold.dim(sbomReport)}]`

  let fullStr = ''
  fullStr += chalk.red(`${ICONS.FAILED}  Failed upload SBOM file ${reportPath}: ${error.message}\n`)
  if (error?.response?.status) {
    fullStr += chalk.red(`API status code: ${error.response.status}\n`)
  }

  return fullStr
}

export const renderUploading = (sbomReport: string, scaRequest: ScaRequest): string => {
  const languages = new Set<string>()
  for (const dep of scaRequest.dependencies) {
    languages.add(dep.language.toString())
  }

  return `Uploading SBOM report in ${sbomReport} (${
    scaRequest.dependencies.length
  } dependencies detected for languages ${Array.from(languages).join(',')})\nUpload for repository ${
    scaRequest.repository.url
  }, branch ${scaRequest.commit.branch}\n`
}

export const renderSuccessfulCommand = (duration: number) => {
  let fullStr = ''
  fullStr += chalk.green(`${ICONS.SUCCESS} Uploaded file in ${duration} seconds.\n`)
  fullStr += chalk.green(`${ICONS.INFO}  Results available on ${getBaseUrl()}ci/code-analysis\n`)
  fullStr += chalk.green(
    '=================================================================================================\n'
  )

  return fullStr
}

export const renderPayloadWarning = (dependencies: Dependency[]): string => {
  let ret = ''

  for (const dep of dependencies) {
    if (!validateDependencyName(dep)) {
      ret += `invalid dependency name ${dep.name}\n`
    }
  }

  return ret
}
