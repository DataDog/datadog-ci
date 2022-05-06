import chalk from 'chalk'
import {BaseContext} from 'clipanion'
import {Writable} from 'stream'

import {
  Assertion,
  ConfigOverride,
  ERRORS,
  ExecutionRule,
  LocationsMapping,
  MainReporter,
  Operator,
  PollResult,
  Result,
  Step,
  Summary,
  Test,
} from '../interfaces'
import {
  getResultDuration,
  getResultExecutionRule,
  getResultOutcome,
  getTestOutcome,
  hasResultPassed,
  TestOrResultOutcome,
} from '../utils'

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
  FAILED_NON_BLOCKING: chalk.bold.yellow('✖'),
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
      const output = ['    - Assertion(s) failed:']
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
const renderResultOutcome = (
  result: Result,
  test: Test,
  executionRule: ExecutionRule,
  icon: string,
  color: chalk.Chalk,
  failOnCriticalErrors: boolean,
  failOnTimeout: boolean
): string | undefined => {
  // Only display critical errors if failure is not filled.
  if (result.error && !(result.failure || result.errorMessage)) {
    return `    ${chalk.bold(`${ICONS.FAILED} | ${result.error}`)}`
  }

  if (result.unhealthy) {
    const errorMessage = result.failure ? result.failure.message : result.errorMessage
    const errorName = errorMessage && errorMessage !== 'Unknown error' ? errorMessage : 'General Error'

    return [
      `    ${chalk.yellow(`${ICONS.SKIPPED} | ${errorName}`)}`,
      `    ${chalk.yellow('We had an error during the execution of this test. The result will be ignored')}`,
    ].join('\n')
  }

  const executionRuleText = executionRule === ExecutionRule.BLOCKING ? '[blocking]' : '[non-blocking]'

  if (test.type === 'api') {
    const requestDescription = renderApiRequestDescription(test.subtype, test.config)

    if (result.failure || (result.errorCode && result.errorMessage)) {
      const errorCode = result.failure ? result.failure.code : result.errorCode
      const errorMessage = result.failure ? result.failure.message : result.errorMessage

      return [
        `    ${icon} ${color(executionRuleText)} ${color(requestDescription)}`,
        renderApiError(errorCode!, errorMessage!, color),
      ].join('\n')
    }

    return `    ${icon} ${color(requestDescription)}`
  }

  if (test.type === 'browser') {
    if (!hasResultPassed(result, failOnCriticalErrors, failOnTimeout) && 'stepDetails' in result) {
      // We render the step only if the test hasn't passed to avoid cluttering the output.
      return result.stepDetails.map(renderStep).join('\n')
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

const renderExecutionResult = (
  test: Test,
  execution: PollResult,
  baseUrl: string,
  locationNames: LocationsMapping,
  failOnCriticalErrors: boolean,
  failOnTimeout: boolean
) => {
  const {check: overriddenTest, dc_id, resultID, result} = execution
  const resultOutcome = getResultOutcome(overriddenTest ?? test, execution, failOnCriticalErrors, failOnTimeout)
  const [icon, setColor] = getTestOrResultIconAndColor(resultOutcome)

  const locationName = !!result.tunnel ? 'Tunneled' : locationNames[dc_id] || dc_id.toString()
  const device = test.type === 'browser' && 'device' in result ? ` - device: ${chalk.bold(result.device.id)}` : ''
  const resultIdentification = setColor(`  ${icon} location: ${chalk.bold(locationName)}${device}`)

  const outputLines = [resultIdentification]

  // Unhealthy test results don't have a duration or result URL
  if (!result.unhealthy) {
    const duration = getResultDuration(result)
    const durationText = duration ? ` total duration: ${duration} ms -` : ''

    const resultUrl = getResultUrl(baseUrl, test, resultID)
    const resultUrlStatus = result.error === ERRORS.TIMEOUT ? '(not yet received)' : ''

    const resultInfo = `    ⎋${durationText} result url: ${chalk.dim.cyan(resultUrl)} ${resultUrlStatus}`
    outputLines.push(resultInfo)
  }

  const resultOutcomeText = renderResultOutcome(
    result,
    overriddenTest || test,
    getResultExecutionRule(test, execution),
    icon,
    setColor,
    failOnCriticalErrors,
    failOnTimeout
  )
  if (resultOutcomeText) {
    outputLines.push(resultOutcomeText)
  }

  return outputLines.join('\n')
}

const getTestOrResultIconAndColor = (testOrResultOutcome: TestOrResultOutcome): [string, chalk.Chalk] => {
  if (testOrResultOutcome === TestOrResultOutcome.Passed) {
    return [ICONS.SUCCESS, chalk.bold.green]
  }

  if (testOrResultOutcome === TestOrResultOutcome.FailedNonBlocking) {
    return [ICONS.FAILED_NON_BLOCKING, chalk.bold.yellow]
  }

  return [ICONS.FAILED, chalk.bold.red]
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
    const resultsSummary = [
      chalk.green(`${chalk.bold(summary.passed)} passed`),
      chalk.red(`${chalk.bold(summary.failed)} failed`),
      chalk.yellow(`${chalk.bold(summary.failedNonBlocking)} failed (non-blocking)`),
    ]

    const testsSummary = [chalk.green(`${chalk.bold(summary.testsFound.size)} found`)]

    if (summary.skipped) {
      testsSummary.push(`${chalk.bold(summary.skipped)} skipped`)
    }

    if (summary.testsNotFound.size > 0) {
      const testsNotFoundStr = chalk.gray(`(${[...summary.testsNotFound].join(', ')})`)
      testsSummary.push(`${chalk.yellow(`${chalk.bold(summary.testsNotFound.size)} not found`)} ${testsNotFoundStr}`)
    }

    const extraInfo = []
    if (summary.timedOut) {
      extraInfo.push(chalk.yellow(`${chalk.bold(summary.timedOut)} timed out`))
    }
    if (summary.criticalErrors) {
      extraInfo.push(chalk.red(`${chalk.bold(summary.criticalErrors)} critical errors`))
    }

    this.write(
      [
        `${chalk.bold('Tests summary:')} ${testsSummary.join(', ')}`,
        `${chalk.bold('Results summary:')} ${resultsSummary.join(', ')}${
          extraInfo.length ? ' (' + extraInfo.join(', ') + ')' : ''
        }\n`,
      ].join('\n')
    )
  }

  public testEnd(
    test: Test,
    results: PollResult[],
    baseUrl: string,
    locationNames: LocationsMapping,
    failOnCriticalErrors: boolean,
    failOnTimeout: boolean
  ) {
    const testOutcome = getTestOutcome(test, results, failOnCriticalErrors, failOnTimeout)
    const idDisplay = `[${chalk.bold.dim(test.public_id)}]`
    const [icon, setColor] = getTestOrResultIconAndColor(testOutcome)

    const testResultsText = results
      .map((r) => renderExecutionResult(test, r, baseUrl, locationNames, failOnCriticalErrors, failOnTimeout))
      .join('\n\n')
      .concat('\n\n')

    this.write([`${icon} ${idDisplay} | ${setColor(test.name)}`, testResultsText].join('\n'))
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

  public testTrigger(test: Pick<Test, 'name'>, testId: string, executionRule: ExecutionRule, config: ConfigOverride) {
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

    const getConfigOverridesPart = () => {
      const nbConfigsOverridden = Object.keys(config).length
      if (nbConfigsOverridden === 0) {
        return ''
      }

      return ' ' + chalk.gray(`(${nbConfigsOverridden} config override${nbConfigsOverridden !== 1 ? 's' : ''})`)
    }

    this.write(`${idDisplay} ${getMessage()}${getConfigOverridesPart()}\n`)
  }

  public testWait(test: Test) {
    return
  }
}
