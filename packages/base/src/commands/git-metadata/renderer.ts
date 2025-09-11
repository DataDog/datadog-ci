import chalk from 'chalk'

import {ICONS} from '@datadog/datadog-ci-base/helpers/formatting'

import {CommitInfo} from './interfaces'

export const renderConfigurationError = (error: Error) => `${ICONS.FAILED} Configuration error: ${error}.`

export const renderFailedUpload = (errorMessage: string) => `${ICONS.FAILED} Failed upload: ${errorMessage}`

export const renderRetriedUpload = (errorMessage: string, attempt: number) =>
  `[attempt ${attempt}] Retrying upload: ${errorMessage}`

export const renderSuccessfulCommand = (duration: number, dryRun: boolean) => {
  if (dryRun) {
    return chalk.green(`${ICONS.SUCCESS} [DRYRUN] Handled in ${duration} seconds.`)
  } else {
    return chalk.green(`${ICONS.SUCCESS} Uploaded in ${duration} seconds.`)
  }
}

export const renderDryRunWarning = () => `${ICONS.WARNING} DRY-RUN MODE ENABLED. WILL NOT UPLOAD`

export const renderCommandInfo = (commit: CommitInfo) =>
  `Reporting commit ${commit.hash} from repository ${commit.remote}.
${commit.trackedFiles.length} tracked file paths will be reported.`
