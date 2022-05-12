import chalk from 'chalk'
import {BaseContext} from 'clipanion'
import {Writable} from 'stream'

import {
  Assertion,
  ConfigOverride,
  ExecutionRule,
  LocationsMapping,
  MainReporter,
  Operator,
  Result,
  Step,
  Summary,
  Test,
} from '../interfaces'
import {getResultDuration} from '../utils'

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
  [Operator.isInLessThan]: 'will expire in less than',
  [Operator.isInMoreThan]: 'will expire in more than',
  [Operator.lessThanOrEqual]: 'should be less than or equal to',
  [Operator.moreThan]: 'should be more than',
  [Operator.moreThanOrEqual]: 'should be less than or equal to',
  [Operator.validatesJSONPath]: 'assert on JSONPath extracted value',
  [Operator.validatesXPath]: 'assert on XPath extracted value',
}

const renderApiError = (errorCode: string, errorMessage: string, color: chalk.Chalk) => {
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

      return color(output.join('\n      '))
    } catch (e) {
      // JSON parsing failed, do nothing to return the raw error
    }
  }

  return chalk.red(`      [${chalk.bold(errorCode)}] - ${chalk.dim(errorMessage)}`)
}

// Test execution rendering
const renderResultOutcome = (result: Result, test: Test, icon: string, color: chalk.Chalk) => {
  if (!result.result) {
    return
  }

  const serverResult = result.result
  // Only display critical errors if failure is not filled.
  const error = result.error || serverResult.error
  if (error && !(serverResult.failure || serverResult.errorMessage)) {
    return `    ${chalk.bold(`${ICONS.FAILED} | ${serverResult.error}`)}`
  }

  if (serverResult.unhealthy) {
    const errorMessage = serverResult.failure ? serverResult.failure.message : serverResult.errorMessage
    const errorName = errorMessage && errorMessage !== 'Unknown error' ? errorMessage : 'General Error'

    return [
      `    ${chalk.yellow(` ${ICONS.SKIPPED} | ${errorName}`)}`,
      `    ${chalk.yellow('We had an error during the execution of this test. The serverResult will be ignored')}`,
    ].join('\n')
  }

  if (test.type === 'api') {
    const requestDescription = renderApiRequestDescription(test.subtype, test.config)

    if (serverResult.failure || (serverResult.errorCode && serverResult.errorMessage)) {
      const errorCode = serverResult.failure ? serverResult.failure.code : serverResult.errorCode
      const errorMessage = serverResult.failure ? serverResult.failure.message : serverResult.errorMessage

      return [`    ${icon} ${color(requestDescription)}`, renderApiError(errorCode!, errorMessage!, color)].join('\n')
    }

    return `    ${icon} ${color(requestDescription)}`
  }

  if (test.type === 'browser') {
    if (!result.passed && 'stepDetails' in serverResult) {
      // We render the step only if the test hasn't passed to avoid cluttering the output.
      return serverResult.stepDetails.map(renderStep).join('\n')
    }

    return ''
  }
}

const renderApiRequestDescription = (subType: string, config: Test['config']): string => {
  const {request, steps} = config
  if (subType === 'dns') {
    const text = `Query for ${request.host}`
    if (request.dnsServer) {
      return `${text} on server ${request.dnsServer}`
    }

    return text
  }

  if (subType === 'ssl' || subType === 'tcp') {
    return `Host: ${request.host}:${request.port}`
  }

  if (subType === 'multi' && steps) {
    const stepsDescription = Object.entries(
      steps
        .map((step) => step.subtype)
        .reduce((counts, type) => {
          counts[type] = (counts[type] || 0) + 1

          return counts
        }, {} as {[key: string]: number})
    )
      .map(([type, count]) => `${count} ${type.toUpperCase()} test`)
      .join(', ')

    return `Multistep test containing ${stepsDescription}`
  }

  if (subType === 'http') {
    return `${chalk.bold(request.method)} - ${request.url}`
  }

  return `${chalk.bold(subType)} test`
}

const getResultUrl = (baseUrl: string, test: Test, resultId: string) => {
  const ciQueryParam = 'from_ci=true'
  const testDetailUrl = `${baseUrl}synthetics/details/${test.public_id}`
  if (test.type === 'browser') {
    return `${testDetailUrl}/result/${resultId}?${ciQueryParam}`
  }

  return `${testDetailUrl}?resultId=${resultId}&${ciQueryParam}`
}

const renderExecutionResult = (test: Test, result: Result, baseUrl: string, locationNames: LocationsMapping) => {
  const color = getTestResultColor(!!result.passed, test.options.ci?.executionRule === ExecutionRule.NON_BLOCKING)
  const icon = result.passed ? ICONS.SUCCESS : ICONS.FAILED

  const locationName = result.hasTunnel ? 'Tunneled' : locationNames[result.location] || result.location
  const serverResult = result.result
  const device = result.device ? ` - device: ${chalk.bold(result.device)}` : ''
  const resultIdentification = color(`  ${icon} location: ${chalk.bold(locationName)}${device}`)

  const outputLines = [resultIdentification]

  // Unhealthy test results don't have a duration or result URL
  if (result.id && !serverResult?.unhealthy) {
    const duration = getResultDuration(result)
    const durationText = duration ? `  total duration: ${duration} ms -` : ''

    const resultUrl = getResultUrl(baseUrl, test, result.id)
    const resultUrlStatus = result.timedOut ? '(not yet received)' : ''

    const resultInfo = `    ⎋${durationText} result url: ${chalk.dim.cyan(resultUrl)} ${resultUrlStatus}`
    outputLines.push(resultInfo)
  }

  const resultOutcome = renderResultOutcome(result, result.test || test, icon, color)
  if (resultOutcome) {
    outputLines.push(resultOutcome)
  }

  return outputLines.join('\n')
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

const getTestResultColor = (success: boolean, isNonBlocking: boolean) => {
  if (success) {
    return chalk.bold.green
  }
  if (isNonBlocking) {
    return chalk.bold.yellow
  }

  return chalk.bold.red
}

export class DefaultReporter implements MainReporter {
  private write: Writable['write']

  constructor({context}: {context: BaseContext}) {
    this.write = context.stdout.write.bind(context.stdout)
  }

  public error(error: string) {
    this.write(error)
  }

  public initErrors(errors: string[]) {
    this.write(errors.join('\n') + '\n\n')
  }

  public log(log: string) {
    this.write(log)
  }

  public reportStart(timings: {startTime: number}) {
    const delay = (Date.now() - timings.startTime).toString()

    this.write(['', chalk.bold.cyan('=== REPORT ==='), `Took ${chalk.bold(delay)}ms`, '\n'].join('\n'))
  }

  public runEnd(summary: Summary) {
    const summaries = [
      chalk.green(`${chalk.bold(summary.passed)} passed`),
      chalk.red(`${chalk.bold(summary.failed)} failed`),
    ]

    if (summary.skipped) {
      summaries.push(`${chalk.bold(summary.skipped)} skipped`)
    }

    if (summary.testsNotFound.size > 0) {
      const testsNotFoundStr = chalk.gray(`(${[...summary.testsNotFound].join(', ')})`)
      summaries.push(`${chalk.yellow(`${chalk.bold(summary.testsNotFound.size)} not found`)} ${testsNotFoundStr}`)
    }

    const extraInfo = []
    if (summary.timedOut) {
      extraInfo.push(chalk.yellow(`${chalk.bold(summary.timedOut)} timed out`))
    }
    if (summary.criticalErrors) {
      extraInfo.push(chalk.red(`${chalk.bold(summary.criticalErrors)} critical errors`))
    }

    this.write(
      `${chalk.bold('Tests execution summary:')} ${summaries.join(', ')}${
        extraInfo.length ? ' (' + extraInfo.join(', ') + ')' : ''
      }\n`
    )
  }

  public testEnd(test: Test, results: Result[], baseUrl: string, locationNames: LocationsMapping) {
    const success = results.every((r) => r.passed)
    const isNonBlocking = test.options.ci?.executionRule === ExecutionRule.NON_BLOCKING

    const icon = renderResultIcon(success, isNonBlocking)

    const idDisplay = `[${chalk.bold.dim(test.public_id)}]`
    const nameColor = getTestResultColor(success, isNonBlocking)
    const nonBlockingText = !success && isNonBlocking ? '[NON-BLOCKING]' : ''

    const testResultsText = results
      .map((r) => renderExecutionResult(test, r, baseUrl, locationNames))
      .join('\n\n')
      .concat('\n\n')

    this.write([`${icon} ${idDisplay}${nonBlockingText} | ${nameColor(test.name)}`, testResultsText].join('\n'))
  }

  public testResult(result: Result): void {
    return
  }

  public testsWait(tests: Test[]) {
    const testsList = tests.map((t) => t.public_id)
    if (testsList.length > 10) {
      testsList.splice(10)
      testsList.push('…')
    }
    const testsDisplay = chalk.gray(`(${testsList.join(', ')})`)

    this.write(
      `Waiting for ${chalk.bold.cyan(tests.length)} test result${tests.length > 1 ? 's' : ''} ${testsDisplay}…\n`
    )
  }

  public testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: ConfigOverride) {
    const idDisplay = `[${chalk.bold.dim(testId)}]`

    const getMessage = () => {
      if (executionRule === ExecutionRule.SKIPPED) {
        // Test is either skipped from datadog-ci config or from test config
        const isSkippedByCIConfig = config.executionRule === ExecutionRule.SKIPPED
        if (isSkippedByCIConfig) {
          return `Skipped test "${chalk.yellow.dim(test.name)}"`
        } else {
          return `Skipped test "${chalk.yellow.dim(test.name)}" because of execution rule configuration in Datadog`
        }
      }

      if (executionRule === ExecutionRule.NON_BLOCKING) {
        return `Found test "${chalk.green.bold(test.name)}" (non-blocking)`
      }

      return `Found test "${chalk.green.bold(test.name)}"`
    }

    this.write(`${idDisplay} ${getMessage()}\n`)
  }

  public testWait(test: Test) {
    return
  }
}
