import chalk from 'chalk'

import {SpanTags} from '../../helpers/interfaces'

import {EvaluationResponse, RuleEvaluation} from './interfaces'

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
  fullStr += chalk.green('Successfully evaluated rules for the current pipeline.\n')
  fullStr += `Overall result: ${renderStatus(evaluationResponse.status)}\n`
  fullStr += `Number of rules evaluated: ${chalk.bold(evaluationResponse.rule_evaluations.length)}\n`

  fullStr += '\n'
  fullStr += chalk.yellow('####### Rules evaluated #######\n')
  evaluationResponse.rule_evaluations.forEach((ruleEvaluation) => (fullStr += renderRuleEvaluation(ruleEvaluation)))

  return fullStr
}

export const renderEmptyEvaluation = (): string => {
  return chalk.yellow('No matching rules were found in Datadog for the current pipeline.\n')
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

export const renderGateEvaluation = (spanTags: SpanTags): string => {
  let fullStr = chalk.bold(`${ICONS.INFO} Evaluating rules matching the following information:\n`)
  fullStr += `Repository: ${spanTags['git.repository_url']}\n`
  fullStr += `Branch: ${spanTags['git.branch']}\n`
  fullStr += `Pipeline Name: ${spanTags['ci.pipeline.name']}\n`
  fullStr += '\n'

  return fullStr
}

export const renderGateEvaluationError = (error: any): string => {
  let fullStr = chalk.red('ERROR: Could not evaluate the rules.')
  if (error.response) {
    fullStr += chalk.red(` Error Status: ${error.response.status}`)
  }

  fullStr += '\n'

  return fullStr
}
