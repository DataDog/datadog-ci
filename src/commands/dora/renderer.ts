import {AxiosError} from 'axios'

import {DeploymentEvent, GitInfo} from './interfaces'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderFailedRequest = (service: string, error: AxiosError) =>
  `${ICONS.FAILED} Failed to send DORA deployment event for service: ${service}: ` +
  (error.response ? JSON.stringify(error.response.data, undefined, 2) : '')

export const renderRetriedRequest = (service: string, error: Error, attempt: number) =>
  `[attempt ${attempt}] Retrying to send DORA deployment event for service: ${service}: ${error.message}`

export const renderSuccessfulRequest = (service: string) =>
  `${ICONS.SUCCESS} Successfully sent DORA deployment event for service: ${service}`

export const renderDryRun = (deployment: DeploymentEvent): string =>
  `[DRYRUN] ${renderRequest(deployment.service)}\n data: ` + JSON.stringify(deployment, undefined, 2)

export const renderRequest = (service: string): string => `Sending DORA deployment event for service: ${service}`

export const renderGitWarning = (git: GitInfo): string =>
  `${ICONS.WARNING} --git-repository-url or --git-commit-sha not provided.\n` +
  `Assuming deployment of the current HEAD commit: ${git.repoURL} ${git.commitSHA}\n` +
  `This warning can be disabled with --skip-git but git data is required for Change Lead Time.`
