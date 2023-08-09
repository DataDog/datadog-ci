import type {TunnelReporter} from '../tunnel/tunnel'
import type {Writable} from 'stream'

import chalk from 'chalk'
import ora from 'ora'

import type {CommandContext} from '../../../helpers/interfaces'

import {
  Assertion,
  Batch,
  ExecutionRule,
  MainReporter,
  Result,
  ServerResult,
  SyntheticsOrgSettings,
  Step,
  Summary,
  Test,
  UserConfigOverride,
} from '../interfaces'
import {
  getBatchUrl,
  getResultDuration,
  getResultOutcome,
  getResultUrl,
  isDeviceIdSet,
  pluralize,
  readableOperation,
  ResultOutcome,
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

  const value = step.value ? `\n    ${chalk.dim(step.value)}` : ''
  const error = step.error ? `\n    ${chalk.red.dim(step.error)}` : ''

  return `    ${icon} | ${duration} - ${step.description}${value}${error}`
}

const renderSkippedSteps = (steps: Step[]): string | undefined => {
  if (!steps.length) {
    return
  }
  if (steps.length === 1) {
    return renderStep(steps[0])
  }

  return `    ${ICONS.SKIPPED} | ${steps.length} skipped steps`
}

const renderApiError = (errorCode: string, errorMessage: string, color: chalk.Chalk) => {
  if (errorCode === 'INCORRECT_ASSERTION') {
    try {
      const assertionsErrors: Assertion[] = JSON.parse(errorMessage)
      const output = [`  - ${pluralize('Assertion', assertionsErrors.length)} failed:`]
      output.push(
        ...assertionsErrors.map((error) => {
          const expected = chalk.underline(`${error.target}`)
          const actual = chalk.underline(`${error.actual}`)

          return `▶ ${error.type} ${readableOperation[error.operator]} ${expected}. Actual: ${actual}`
        })
      )

      return color(output.join('\n    '))
    } catch (e) {
      // JSON parsing failed, do nothing to return the raw error
    }
  }

  return chalk.red(`    [${chalk.bold(errorCode)}] - ${chalk.dim(errorMessage)}`)
}

// Test execution rendering
const renderResultOutcome = (
  result: ServerResult,
  test: Test,
  icon: string,
  color: chalk.Chalk
): string | undefined => {
  if (result.unhealthy) {
    const error =
      result.failure && result.failure.message !== 'Unknown error' ? result.failure.message : 'General Error'

    return [
      `  ${chalk.yellow(`${ICONS.SKIPPED} | ${error}`)}`,
      `  ${chalk.yellow('We had an error during the execution of this test. The result will be ignored')}`,
    ].join('\n')
  }

  if (test.type === 'api') {
    const requestDescription = renderApiRequestDescription(test.subtype, test.config)

    if (result.failure) {
      return [
        `  ${icon} ${color(requestDescription)}`,
        renderApiError(result.failure.code, result.failure.message, color),
      ].join('\n')
    }

    return `  ${icon} ${color(requestDescription)}`
  }

  if (test.type === 'browser') {
    // We render the step only if the test hasn't passed to avoid cluttering the output.
    if (!result.passed && 'stepDetails' in result) {
      const criticalFailedStepIndex = result.stepDetails.findIndex((s) => s.error && !s.allowFailure) + 1
      const stepsDisplay = result.stepDetails.slice(0, criticalFailedStepIndex).map(renderStep)

      const skippedStepDisplay = renderSkippedSteps(result.stepDetails.slice(criticalFailedStepIndex))
      if (skippedStepDisplay) {
        stepsDisplay.push(skippedStepDisplay)
      }

      return stepsDisplay.join('\n')
    }

    if (result.failure) {
      return chalk.red(`    [${chalk.bold(result.failure.code)}] - ${chalk.dim(result.failure.message)}`)
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

const renderExecutionResult = (test: Test, execution: Result, baseUrl: string) => {
  const {executionRule, test: overriddenTest, resultId, result, timedOut} = execution
  const resultOutcome = getResultOutcome(execution)
  const [icon, setColor] = getResultIconAndColor(resultOutcome)

  const executionRuleText = [ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)
    ? ''
    : `[${setColor(executionRule === ExecutionRule.BLOCKING ? 'blocking' : 'non-blocking')}] `

  const testLabel = `${executionRuleText}[${chalk.bold.dim(test.public_id)}] ${chalk.bold(test.name)}`

  const location = setColor(`location: ${chalk.bold(execution.location)}`)
  const device = isDeviceIdSet(result) ? ` - ${setColor(`device: ${chalk.bold(result.device.id)}`)}` : ''
  const resultIdentification = `${icon} ${testLabel} - ${location}${device}`

  const outputLines = [resultIdentification]

  // Unhealthy test results don't have a duration or result URL
  if (!result.unhealthy) {
    const duration = getResultDuration(result)
    const durationText = duration ? ` Total duration: ${duration} ms -` : ''

    const resultUrl = getResultUrl(baseUrl, test, resultId)
    const resultUrlStatus = timedOut ? '(not yet received)' : ''

    const resultInfo = `  ⎋${durationText} View test run details: ${chalk.dim.cyan(resultUrl)} ${resultUrlStatus}`
    outputLines.push(resultInfo)
  }

  const resultOutcomeText = renderResultOutcome(result, overriddenTest || test, icon, setColor)
  if (resultOutcomeText) {
    outputLines.push(resultOutcomeText)
  }

  return outputLines.join('\n')
}

const getResultIconAndColor = (resultOutcome: ResultOutcome): [string, chalk.Chalk] => {
  if (resultOutcome === ResultOutcome.Passed || resultOutcome === ResultOutcome.PassedNonBlocking) {
    return [ICONS.SUCCESS, chalk.bold.green]
  }

  if (resultOutcome === ResultOutcome.FailedNonBlocking) {
    return [ICONS.FAILED_NON_BLOCKING, chalk.bold.yellow]
  }

  return [ICONS.FAILED, chalk.bold.red]
}

export class DefaultReporter implements MainReporter {
  private context: CommandContext
  private testWaitSpinner?: ora.Ora
  private write: Writable['write']
  private totalDuration?: number

  constructor({context}: {context: CommandContext}) {
    this.context = context
    this.write = context.stdout.write.bind(context.stdout)
  }

  public error(error: string) {
    this.stopSpinner()
    this.write(error)
  }

  public initErrors(errors: string[]) {
    this.stopSpinner()
    this.write(errors.join('\n') + '\n\n')
  }

  public log(log: string) {
    this.stopSpinner()
    this.write(log)
  }

  public reportStart(timings: {startTime: number}) {
    this.totalDuration = Date.now() - timings.startTime

    this.stopSpinner()
    this.write(
      ['', chalk.bold.cyan('=== REPORT ==='), `Took ${chalk.bold(this.totalDuration).toString()}ms`, '\n'].join('\n')
    )
  }

  public resultEnd(result: Result, baseUrl: string) {
    this.write(renderExecutionResult(result.test, result, baseUrl) + '\n\n')
  }

  public resultReceived(result: Batch['results'][0]): void {
    return
  }

  public runEnd(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings) {
    const {bold: b, gray, green, red, yellow} = chalk

    const lines: string[] = []

    const runSummary = [green(`${b(summary.passed)} passed`), red(`${b(summary.failed)} failed`)]

    if (summary.failedNonBlocking) {
      runSummary.push(yellow(`${b(summary.failedNonBlocking)} failed (non-blocking)`))
    }

    if (summary.skipped) {
      runSummary.push(`${b(summary.skipped)} skipped`)
    }

    if (summary.testsNotFound.size > 0) {
      const testsNotFoundListStr = gray(`(${[...summary.testsNotFound].join(', ')})`)
      lines.push(
        `${yellow(
          `${b(summary.testsNotFound.size)} ${pluralize('test', summary.testsNotFound.size)} not found`
        )} ${testsNotFoundListStr}`
      )
    }

    const extraInfo = []
    if (summary.timedOut) {
      extraInfo.push(yellow(`${b(summary.timedOut)} timed out`))
    }
    if (summary.criticalErrors) {
      extraInfo.push(red(`${b(summary.criticalErrors)} critical errors`))
    }
    const extraInfoStr = extraInfo.length ? ' (' + extraInfo.join(', ') + ')' : ''

    if (summary.batchId) {
      const batchUrl = getBatchUrl(baseUrl, summary.batchId)
      lines.push('View full summary in Datadog: ' + chalk.dim.cyan(batchUrl))
    }
    lines.push(`\n${b('Continuous Testing Summary:')}`)
    lines.push(`Test Results: ${runSummary.join(', ')}${extraInfoStr}`)

    if (orgSettings && orgSettings.onDemandConcurrencyCap > 0) {
      lines.push(
        `Max parallelization configured: ${orgSettings.onDemandConcurrencyCap} test${
          orgSettings.onDemandConcurrencyCap > 1 ? 's' : ''
        } running at the same time`
      )
    }

    if (this.totalDuration) {
      const min = Math.floor(this.totalDuration / (60 * 1000))
      const sec = Math.round((this.totalDuration % (60 * 1000)) / 1000)
      lines.push(
        `Total Duration:${min > 0 ? ' ' + min.toString() + 'm' : ''}${sec > 0 ? ' ' + sec.toString() + 's' : ''}`
      )
    }

    if (orgSettings && orgSettings.onDemandConcurrencyCap > 0) {
      lines.push(
        `\nIncrease your parallelization to reduce your total duration: ${chalk.dim.cyan(
          baseUrl + 'synthetics/settings/continuous-testing'
        )}\n`
      )
    }

    this.write(lines.join('\n'))
  }

  public testsWait(tests: Test[], baseUrl: string, batchId: string) {
    const testsList = tests.map((t) => t.public_id)
    if (testsList.length > 10) {
      testsList.splice(10)
      testsList.push('…')
    }
    const testsDisplay = chalk.gray(`(${testsList.join(', ')})`)

    const batchUrl = getBatchUrl(baseUrl, batchId)
    this.write(`View pending summary in Datadog: ${chalk.dim.cyan(batchUrl)}\n\n`)

    this.testWaitSpinner = ora({
      stream: this.context.stdout,
      text: `Waiting for ${chalk.bold.cyan(tests.length)} test ${pluralize('result', tests.length)} ${testsDisplay}…\n`,
    }).start()
  }

  public testTrigger(
    test: Pick<Test, 'name'>,
    testId: string,
    executionRule: ExecutionRule,
    config: UserConfigOverride
  ) {
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
      if (nbConfigsOverridden === 0 || executionRule === ExecutionRule.SKIPPED) {
        return ''
      }

      return ' ' + chalk.gray(`(${nbConfigsOverridden} config ${pluralize('override', nbConfigsOverridden)})`)
    }

    this.write(`${idDisplay} ${getMessage()}${getConfigOverridesPart()}\n`)
  }

  public testWait(test: Test) {
    return
  }

  private stopSpinner() {
    this.testWaitSpinner?.stopAndPersist()
    delete this.testWaitSpinner
  }
}

export const getTunnelReporter = (reporter: MainReporter): TunnelReporter => ({
  log: (message) => reporter.log(`[${chalk.bold.blue('Tunnel')}] ${message}\n`),
  error: (message) => reporter.error(`[${chalk.bold.yellow('Tunnel')}] ${message}\n`),
  warn: (message) => reporter.error(`[${chalk.bold.red('Tunnel')}] ${message}\n`),
})
