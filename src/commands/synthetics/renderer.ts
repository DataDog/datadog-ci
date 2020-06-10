import chalk from 'chalk'

import {
  Assertion,
  ConfigOverride,
  ExecutionRule,
  LocationsMapping,
  Operator,
  PollResult,
  Result,
  Step,
  Test,
} from './interfaces'
import {hasResultPassed, hasTestSucceeded} from './utils'

// Step rendering

const renderStepDuration = (duration: number) => {
  const getColor = () => {
    if (duration > 10000) {
      return chalk.bold.red
    }
    if (duration > 5000) {
      return chalk.bold.yellow
    }

    return chalk.bold
  }
  const color = getColor()

  return `${color(duration.toString())}ms`
}

const ICONS = {
  FAILED: chalk.bold.red('✖'),
  SKIPPED: chalk.bold.yellow('⇢'),
  SUCCESS: chalk.bold.green('✓'),
}

const renderStepIcon = (step: Step) => {
  if (step.error) {
    return ICONS.FAILED
  }
  if (step.skipped) {
    return ICONS.SKIPPED
  }

  return ICONS.SUCCESS
}

const renderStep = (step: Step) => {
  const duration = renderStepDuration(step.duration)
  const icon = renderStepIcon(step)

  const value = step.value ? `\n      ${chalk.dim(step.value)}` : ''
  const error = step.error ? `\n      ${chalk.red.dim(step.error)}` : ''

  return `    ${icon} | ${duration} - ${step.description}${value}${error}`
}

const readableOperation: {[key in Operator]: string} = {
  [Operator.contains]: 'should contain',
  [Operator.doesNotContain]: 'should not contain',
  [Operator.is]: 'should be',
  [Operator.isNot]: 'should not be',
  [Operator.lessThan]: 'should be less than',
  [Operator.matches]: 'should match',
  [Operator.doesNotMatch]: 'should not match',
  [Operator.validates]: 'will expire in less than',
  [Operator.isInLessThan]: 'will expire in less than',
  [Operator.isInMoreThan]: 'will expire in more than',
}

const renderApiError = (errorCode: string, errorMessage: string) => {
  if (errorCode === 'INCORRECT_ASSERTION') {
    try {
      const assertionsErrors: Assertion[] = JSON.parse(errorMessage)
      const output = [' - Assertion(s) failed:']
      output.push(
        ...assertionsErrors.map((error) => {
          const expected = chalk.underline(`${error.target}`)
          const actual = chalk.underline(`${error.actual}`)

          return `▶ ${error.type} ${readableOperation[error.operator]} ${expected}. Actual: ${actual}`
        })
      )

      return chalk.red(output.join('\n      '))
    } catch (e) {
      // JSON parsing failed, do nothing to return the raw error
    }
  }

  return chalk.red(`      [${chalk.bold(errorCode)}] - ${chalk.dim(errorMessage)}`)
}

// Test execution rendering
const renderResultOutcome = (result: Result, test: Test, icon: string, color: typeof chalk) => {
  if (result.error) {
    return `    ${chalk.red.bold(`✖ | ${result.error}`)}`
  }

  if (result.unhealthy) {
    return `    ${chalk.red.bold(`✖ | ${result.errorMessage || 'General Error'}`)}`
  }

  if (test.type === 'api') {
    const requestDescription = `${chalk.bold(test.config.request.method)} - ${test.config.request.url}`

    if (result.errorCode && result.errorMessage) {
      return [`    ${icon} ${color(requestDescription)}`, renderApiError(result.errorCode!, result.errorMessage!)].join(
        '\n'
      )
    }

    return `    ${icon} ${color(requestDescription)}`
  }

  if (test.type === 'browser') {
    if (!hasResultPassed(result) && result.stepDetails) {
      // We render the step only if the test hasn't passed to avoid cluttering the output.
      return result.stepDetails.map(renderStep).join('\n')
    }

    return ''
  }
}

const getResultUrl = (baseUrl: string, test: Test, resultId: string) => {
  const testDetailUrl = `${baseUrl}synthetics/details/${test.public_id}`
  if (test.type === 'browser') {
    return `${testDetailUrl}/result/${resultId}`
  }

  return `${testDetailUrl}?resultId=${resultId}`
}

const renderExecutionResult = (test: Test, execution: PollResult, baseUrl: string, locationNames: LocationsMapping) => {
  const {dc_id, resultID, result} = execution
  const isSuccess = hasResultPassed(result)
  const color = isSuccess ? chalk.green : chalk.red
  const icon = isSuccess ? ICONS.SUCCESS : ICONS.FAILED

  const locationName = locationNames[dc_id] || dc_id.toString()
  const device = test.type === 'browser' && result.device ? ` - device: ${chalk.bold(result.device.id)}` : ''
  const resultIdentification = color(`  ${icon} location: ${chalk.bold(locationName)}${device}`)

  const duration = test.type === 'browser' ? result.duration : result.timings?.total
  const durationText = duration ? `  total duration: ${duration} ms -` : ''
  const resultUrl = getResultUrl(baseUrl, test, resultID)

  return [
    resultIdentification,
    `    ⎋${durationText} result url: ${chalk.dim.cyan(resultUrl)}`,
    renderResultOutcome(result, test, icon, color),
  ].join('\n')
}

// Results of all tests rendering
const renderResultIcon = (success: boolean, isNonBlocking: boolean) => {
  if (success) {
    return ICONS.SUCCESS
  }
  if (isNonBlocking) {
    return ICONS.SKIPPED
  }

  return ICONS.FAILED
}

export const renderResults = (test: Test, results: PollResult[], baseUrl: string, locationNames: LocationsMapping) => {
  const success = hasTestSucceeded(results)
  const isNonBlocking = test.options.ci?.executionRule === ExecutionRule.NON_BLOCKING

  const icon = renderResultIcon(success, isNonBlocking)

  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`
  const nameColor = success ? chalk.bold.green : chalk.bold.red
  const nonBlockingText = !success && isNonBlocking ? 'This test is set to be non-blocking in Datadog' : ''

  const testResultsText = results
    .map((r) => renderExecutionResult(test, r, baseUrl, locationNames))
    .join('\n')
    .concat('\n')

  return [`${icon} ${idDisplay} | ${nameColor(test.name)} ${nonBlockingText}`, testResultsText].join('\n')
}

// Other rendering
export const renderTrigger = (test: Test | undefined, testId: string, config: ConfigOverride) => {
  const idDisplay = `[${chalk.bold.dim(testId)}]`

  const getMessage = () => {
    if (!test) {
      return chalk.red.bold(`Could not find test "${testId}"`)
    }
    if (config.executionRule === ExecutionRule.SKIPPED) {
      return `>> Skipped test "${chalk.yellow.dim(test.name)}"`
    }
    if (test.options?.ci?.executionRule === ExecutionRule.SKIPPED) {
      return `>> Skipped test "${chalk.yellow.dim(test.name)}" because of execution rule configuration in Datadog`
    }

    return `Trigger test "${chalk.green.bold(test.name)}"`
  }

  return `${idDisplay} ${getMessage()}\n`
}

export const renderHeader = (timings: {startTime: number}) => {
  const delay = (Date.now() - timings.startTime).toString()

  return ['\n', chalk.bold.cyan('=== REPORT ==='), `Took ${chalk.bold(delay)}ms`, '\n'].join('\n')
}

export const renderWait = (test: Test) => {
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`

  return `${idDisplay} Waiting results for "${chalk.green.bold(test.name)}"\n`
}
