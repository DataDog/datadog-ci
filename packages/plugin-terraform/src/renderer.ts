import chalk from 'chalk'

import {TerraformArtifactPayload} from './interfaces'

export const renderCommandInfo = (artifactType: string, filePath: string, dryRun: boolean): string => {
  const prefix = dryRun ? '[DRYRUN] ' : ''

  return `${prefix}Uploading Terraform ${artifactType} file: ${filePath}\n`
}

export const renderDryRunUpload = (payload: TerraformArtifactPayload): string => {
  return chalk.yellow(`[DRYRUN] Would upload: ${payload.filePath}\n`)
}

export const renderSuccessfulUpload = (filePath: string): string => {
  return chalk.green(`✓ Successfully uploaded: ${filePath}\n`)
}

export const renderFailedUpload = (filePath: string, error: any): string => {
  const message = error?.message || 'Unknown error'

  return chalk.red(`✗ Failed to upload ${filePath}: ${message}\n`)
}

export const renderInvalidFile = (filePath: string, reason: string): string => {
  return chalk.red(`✗ Invalid file ${filePath}: ${reason}\n`)
}

export const renderSuccessfulGitDBSync = (dryRun: boolean, elapsed: number): string => {
  const prefix = dryRun ? '[DRYRUN] ' : ''

  return chalk.green(`${prefix}✓ Git metadata synced (${elapsed}ms)\n`)
}

export const renderFailedGitDBSync = (error: any): string => {
  const message = error?.message || 'Unknown error'

  return chalk.yellow(`⚠ Failed to sync git metadata: ${message}\n`)
}
