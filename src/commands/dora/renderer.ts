import chalk from 'chalk'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
}

export const renderFailedRequest = (service: string, errorMessage: string) => {
  return chalk.red(`${ICONS.FAILED} Failed to send DORA deployment event for service: ${service}: ${errorMessage}\n`)
}

export const renderRetriedRequest = (service: string, errorMessage: string, attempt: number) => {
  return chalk.yellow(
    `[attempt ${attempt}] Retrying to send DORA deployment event for service: ${service}: ${errorMessage}\n`
  )
}

export const renderSuccessfulRequest = (service: string) => {
  return chalk.green(`${ICONS.SUCCESS} Successfuly sent DORA deployment event for service: ${service}`)
}

export const renderDryRun = (service: string): string => `[DRYRUN] ${renderRequest(service)}`

export const renderRequest = (service: string): string => `Sending DORA deployment event for service: ${service}`
