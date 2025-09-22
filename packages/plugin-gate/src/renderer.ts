import {GIT_BRANCH, GIT_REPOSITORY_URL} from '@datadog/datadog-ci-base/helpers/tags'
import chalk from 'chalk'

import {EvaluationResponse, Payload, RuleEvaluation} from './interfaces'
import {getStatus, is5xxError, isBadRequestError, isTimeout, getBaseUrl} from './utils'

const ICONS = {
  FAILED: '❌',
  SUCCESS: '✅',
  WARNING: '⚠️',
  INFO: 'ℹ️',
}

export const renderEvaluationResponse = (evaluationResponse: EvaluationResponse) => {
  if (evaluationResponse.status.toLowerCase() === 'empty') {
    return renderEmptyEvaluation()
  }
  if (evaluationResponse.status.toLowerCase() === 'dry_run') {
    return renderDryRunEvaluation(evaluationResponse)
  }

  let fullStr = ''
  fullStr += chalk.green('Successfully evaluated all matching rules.\n')
  fullStr += `Overall result: ${renderStatus(evaluationResponse.status)}\n`
  fullStr += `Number of rules evaluated: ${chalk.bold(evaluationResponse.rule_evaluations.length)}\n`

  fullStr += '\n'
  fullStr += chalk.yellow('####### Rules evaluated #######\n')
  evaluationResponse.rule_evaluations.forEach((ruleEvaluation) => (fullStr += renderRuleEvaluation(ruleEvaluation)))

  return fullStr
}

export const renderEmptyEvaluation = (): string => {
  return chalk.yellow(
    `${ICONS.WARNING} No matching rules were found in Datadog. Use the '--fail-on-empty' option to fail the command in this situation.\n`
  )
}

export const renderStatus = (result: string): string => {
  switch (result.toLowerCase()) {
    case 'passed':
      return chalk.green(`Passed ${ICONS.SUCCESS} `)
    case 'failed':
      return chalk.red(`Failed ${ICONS.FAILED} `)
    case 'no_data':
      return chalk.yellow(`No Data ${ICONS.WARNING} `)
    case 'dry_run':
      return chalk.yellow(`Dry Run ${ICONS.INFO}`)
  }

  return result.toLowerCase()
}

export const renderRuleUrl = (ruleId: string): string => {
  return `${getBaseUrl()}ci/quality-gates/rule/${ruleId}`
}

export const renderRuleEvaluation = (ruleEvaluation: RuleEvaluation): string => {
  let fullStr = ''
  fullStr += `Rule Name: ${ruleEvaluation.rule_name}\n`
  fullStr += `Rule URL: ${renderRuleUrl(ruleEvaluation.rule_id)}\n`
  fullStr += `Status: ${renderStatus(ruleEvaluation.status)}\n`
  if (ruleEvaluation.status.toLowerCase() === 'failed') {
    fullStr += `${chalk.red.bold('Failure reason')}: ${ruleEvaluation.failure_reason}\n`
  }

  fullStr += `${chalk.yellow('Blocking')}: ${ruleEvaluation.is_blocking}\n`
  if (ruleEvaluation.details_url) {
    fullStr += `Details: ${ruleEvaluation.details_url}\n`
  }

  fullStr += '\n'

  return fullStr
}

export const renderDryRunEvaluation = (evaluationResponse: EvaluationResponse): string => {
  let fullStr = ''
  fullStr += chalk.green('Successfully completed a dry run request\n')
  fullStr += `Overall result: ${renderStatus(evaluationResponse.status)}\n`
  fullStr += `Number of matching rules: ${chalk.bold(evaluationResponse.rule_evaluations.length)}\n`

  if (evaluationResponse.rule_evaluations.length > 0) {
    fullStr += '\n'
    fullStr += chalk.yellow('####### Matching rules #######\n')
    evaluationResponse.rule_evaluations.forEach((ruleEvaluation) => (fullStr += renderRuleEvaluation(ruleEvaluation)))
  }

  return fullStr
}

export const renderGateEvaluationInput = (evaluateRequest: Payload): string => {
  let fullStr = chalk.bold(`${ICONS.INFO} Evaluating rules matching the following information:\n`)
  fullStr += `Repository: ${evaluateRequest.spanTags[GIT_REPOSITORY_URL]}\n`
  fullStr += `Branch: ${evaluateRequest.spanTags[GIT_BRANCH]}\n`

  for (const [scopeKey, scopeValue] of Object.entries(evaluateRequest.userScope)) {
    const valueString = scopeValue.join(' OR ')
    fullStr += `${scopeKey}: ${valueString}\n`
  }

  fullStr += '\n'

  return fullStr
}

export const renderGateEvaluationError = (error: any, failIfUnavailable: boolean): string => {
  let errorStr = 'ERROR: Could not evaluate the rules.'

  if (error.message === 'wait') {
    errorStr += ` The command timed out.\n`
  }

  if (error.response) {
    errorStr += ` Status code: ${error.response.status}.\n`
  }

  if (isBadRequestError(error)) {
    const errorMessage = error.response.data.errors[0].detail
    errorStr += `Error is "${errorMessage}".\n`
  } else if ((is5xxError(error) || isTimeout(error)) && !failIfUnavailable) {
    errorStr += "Use the '--fail-if-unavailable' option to fail the command in this situation.\n"
  }

  return chalk.red(errorStr)
}

export const renderEvaluationRetry = (attempt: number, error: any): string => {
  if (is5xxError(error)) {
    const errorStatus = getStatus(error)

    return chalk.yellow(`[attempt ${attempt}] Gate evaluation failed with status code ${errorStatus}, retrying.\n`)
  }

  return chalk.yellow(`[attempt ${attempt}] Gate evaluation failed, retrying.\n`)
}

export const renderWaiting = (): string => {
  return 'Waiting for events to arrive...\n'
}
