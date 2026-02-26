import chalk from 'chalk'

import {dryRunTag, failCrossTag, successCheckmarkTag} from '@datadog/datadog-ci-base/helpers/renderer'
import {TerraformArtifactPayload} from './interfaces'

export const renderCommandInfo = (artifactType: string, filePath: string, dryRun: boolean): string => {
  const prefix = dryRun ? `${dryRunTag} ` : ''

  return `${prefix}Uploading Terraform ${artifactType} file: ${filePath}\n`
}

export const renderDryRunUpload = (payload: TerraformArtifactPayload): string => {
  return `${dryRunTag} Would upload: ${payload.filePath}\n`
}

export const renderSuccessfulUpload = (filePath: string): string => {
  return `${successCheckmarkTag} Successfully uploaded: ${filePath}\n`
}

export const renderFailedUpload = (filePath: string, error: any): string => {
  const message = error?.message || 'Unknown error'

  return `${failCrossTag} Failed to upload ${filePath}: ${message}\n`
}

export const renderInvalidFile = (filePath: string, reason: string): string => {
  return `${failCrossTag} Invalid file ${filePath}: ${reason}\n`
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number): string => {
  const prefix = dryRun ? `${dryRunTag} ` : ''

  return `${prefix}${successCheckmarkTag} Git metadata synced (${elapsed}ms)\n`
}

export const renderFailedGitDBSync = (error: any): string => {
  const message = error?.message || 'Unknown error'

  return chalk.yellow(`⚠ Failed to sync git metadata: ${message}\n`)
}
