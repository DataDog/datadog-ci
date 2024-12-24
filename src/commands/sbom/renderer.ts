import chalk from 'chalk'

import {getBaseUrl} from '../junit/utils'
import {Dependency} from './types'
import {validateDependency, validateDependencyName} from './validation'

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

  fullStr += chalk.red(`Default branch not found for repository ${repositoryUrl}\n`)
  fullStr += chalk.red(`Fix this issue by either:\n`)
  fullStr += chalk.red(` - define a default branch in the repository settings on Datadog\n`)
  fullStr += chalk.red(` - push result from your default branch first\n\n`)
  fullStr += chalk.red(`Run an analysis once the issue is resolved\n`)

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

export const renderUploading = (sbomReport: string): string => `Uploading SBOM report in ${sbomReport}\n`

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
