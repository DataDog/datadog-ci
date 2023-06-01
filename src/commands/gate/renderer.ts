import chalk from 'chalk'

import {GIT_BRANCH, GIT_REPOSITORY_URL} from '../../helpers/tags'

import {EvaluationResponse, Payload, RuleEvaluation} from './interfaces'
import {getStatus, is4xxError, is5xxError} from './utils'

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
  }

  return 'Unknown Status: ' + result.toLowerCase()
}

export const renderRuleEvaluation = (ruleEvaluation: RuleEvaluation): string => {
  // TODO add URL here once we have it
  let fullStr = ''
  fullStr += `Rule ID: ${ruleEvaluation.rule_id}\n`
  fullStr += `Rule Name: ${ruleEvaluation.rule_name}\n`
  fullStr += `Status: ${renderStatus(ruleEvaluation.status)}\n`
  if (ruleEvaluation.status.toLowerCase() === 'failed') {
    fullStr += `${chalk.red.bold('Failure reason')}: ${ruleEvaluation.failure_reason}\n`
  }

  fullStr += `${chalk.yellow('Blocking')}: ${ruleEvaluation.is_blocking}\n`
  fullStr += '\n'

  return fullStr
}

export const renderDryRunEvaluation = (): string => {
  return chalk.yellow('Dry run mode is enabled. Not evaluating the rules.')
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

export const renderGateEvaluationError = (error: any): string => {
  if (error.response && is4xxError(error)) {
    const errorMessage = error.response.data.errors[0].detail
    return chalk.red(`ERROR: Could not evaluate the rules. Error is "${errorMessage}".`)
  }

  let fullStr = chalk.red('ERROR: Could not evaluate the rules.')
  if (error.response) {
    fullStr += chalk.red(` Status code: ${error.response.status}\n`)
    if (is5xxError(error)) {
      fullStr += chalk.red("Use the '--fail-if-unavailable' option to fail the command in this situation.\n")
    }
  }

  return fullStr
}

export const renderEvaluationRetry = (attempt: number, error: any): string => {
  if (is5xxError(error)) {
    let errorStatus = getStatus(error);
    return chalk.yellow(`[attempt ${attempt}] Gate evaluation failed with status code ${errorStatus}, retrying.\n`)
  }

  return chalk.yellow(`[attempt ${attempt}] Gate evaluation failed, retrying.\n`)
}
