import c from 'chalk'
import {BaseContext} from 'clipanion'
import {promises as fs} from 'fs'
import path from 'path'
import {Writable} from 'stream'
import {Builder} from 'xml2js'

import {ApiServerResult, MultiStep, Reporter, Result, Step, Summary, Vitals} from '../interfaces'
import {getBatchUrl, getResultDuration, getResultOutcome, getResultUrl, isDeviceIdSet, ResultOutcome} from '../utils'

interface StepStats {
  allowfailures: number
  errors: number
  failures: number
  skipped: number
  tests: number
  warnings: number
}

interface XMLRunProperties extends StepStats {
  name: string
}

interface XMLRun {
  $: XMLRunProperties
  testcase: XMLTestCase[]
}

interface XMLTestCaseProperties extends StepStats {
  name: string
  time: number | undefined
  timestamp: string
}

export interface XMLTestCase {
  $: XMLTestCaseProperties
  // These are singular for a better display in the XML format of the report.
  allowed_error: XMLError[]
  browser_error: XMLError[]
  error: XMLError[]
  properties: {
    property: {$: {name: string; value: any}}[]
  }
  testcase: XMLStep[]
  warning: XMLError[]
}

interface XMLStepProperties extends StepStats {
  allow_failure: boolean
  is_skipped: boolean
  name: string
  substep_public_id?: string
  time: number
  type: string
  url?: string
}

interface XMLStep {
  $: XMLStepProperties
  browser_error?: {$: {name: string; type: string}; _: string}[]
  error: {$: {type: 'assertion'}; _: string}[]
  vitals?: {$: Vitals}[]
  warning?: {$: {type: string}; _: string}[]
}

export interface XMLJSON {
  testsuites: {
    $: {
      batch_id?: string
      batch_url?: string
      name: string
      tests_critical_error: number
      tests_failed: number
      tests_failed_non_blocking: number
      tests_not_found: number
      tests_passed: number
      tests_skipped: number
      tests_timed_out: number
    }
    testsuite: XMLRun[]
  }
}

interface XMLError {
  $: {type: string; [key: string]: string}
  _: string
}

export interface Args {
  context: BaseContext
  jUnitReport?: string
  runName?: string
}

export const getDefaultStats = (): StepStats => ({
  allowfailures: 0,
  errors: 0,
  failures: 0,
  skipped: 0,
  tests: 0,
  warnings: 0,
})

// Return the stats from a given object
// based on getDefaultStats
const getStats = (obj: StepStats): StepStats => {
  const baseStats = getDefaultStats()
  for (const entry of Object.entries(baseStats)) {
    const [key, value] = entry as [keyof StepStats, number]
    baseStats[key] = value || baseStats[key]
  }

  return baseStats
}

export class JUnitReporter implements Reporter {
  private builder: Builder
  private destination: string
  private json: XMLJSON
  private write: Writable['write']

  constructor({context, jUnitReport, runName}: Args) {
    this.write = context.stdout.write.bind(context.stdout)
    this.destination = jUnitReport!
    if (!this.destination.endsWith('.xml')) {
      this.destination += '.xml'
    }
    this.builder = new Builder()
    this.json = {
      testsuites: {
        $: {
          name: runName || 'Undefined run',
          tests_critical_error: 0,
          tests_failed: 0,
          tests_failed_non_blocking: 0,
          tests_not_found: 0,
          tests_passed: 0,
          tests_skipped: 0,
          tests_timed_out: 0,
        },
        testsuite: [],
      },
    }
  }

  public resultEnd(result: Result, baseUrl: string) {
    const suiteRunName = result.test.suite || 'Undefined suite'
    let suiteRun = this.json.testsuites.testsuite.find((suite: XMLRun) => suite.$.name === suiteRunName)

    if (!suiteRun) {
      suiteRun = {
        $: {name: suiteRunName, ...getDefaultStats()},
        testcase: [],
      }
      this.json.testsuites.testsuite.push(suiteRun as XMLRun)
    }

    // Update stats for the suite.
    suiteRun.$ = {
      ...suiteRun.$,
      ...this.getResultStats(result, getStats(suiteRun.$)),
    }

    const testCase: XMLTestCase = this.getTestCase(result, baseUrl)
    // Timeout errors are only reported at the top level.
    if (result.timedOut) {
      testCase.error.push({
        $: {type: 'timeout'},
        _: String(result.result.failure?.message),
      })
    }
    if ('stepDetails' in result.result) {
      // It's a browser test.
      for (const stepDetail of result.result.stepDetails) {
        const {allowed_error, browser_error, error, warning} = this.getBrowserTestStep(stepDetail)
        testCase.allowed_error.push(...allowed_error)
        testCase.browser_error.push(...browser_error)
        testCase.error.push(...error)
        testCase.warning.push(...warning)
      }
    } else if ('steps' in result.result) {
      // It's a multistep test.
      for (const step of result.result.steps) {
        const {allowed_error, error} = this.getApiTestStep(step)
        testCase.allowed_error.push(...allowed_error)
        testCase.error.push(...error)
      }
    }

    suiteRun.testcase.push(testCase)
  }

  public async runEnd(summary: Summary, baseUrl: string) {
    Object.assign(this.json.testsuites.$, {
      tests_critical_error: summary.criticalErrors,
      tests_failed: summary.failed,
      tests_failed_non_blocking: summary.failedNonBlocking,
      tests_not_found: summary.testsNotFound.size,
      tests_passed: summary.passed,
      tests_skipped: summary.skipped,
      tests_timed_out: summary.timedOut,
    })

    this.json.testsuites.$.batch_id = summary.batchId
    if (summary.batchId) {
      this.json.testsuites.$.batch_url = getBatchUrl(baseUrl, summary.batchId)
    }

    // Write the file
    try {
      const xml = this.builder.buildObject(this.json)
      await fs.mkdir(path.dirname(this.destination), {recursive: true})
      await fs.writeFile(this.destination, xml, 'utf8')
      this.write(`✅ Created a jUnit report at ${c.bold.green(this.destination)}\n`)
    } catch (e) {
      this.write(`❌ Couldn't write the report to ${c.bold.green(this.destination)}:\n${e.toString()}\n`)
    }
  }

  private getApiStepStats(step: MultiStep | ApiServerResult): StepStats {
    // TODO use more granular result based on step.assertionResults
    let allowfailures = 0
    let skipped = 0
    if ('allowFailure' in step) {
      allowfailures += step.allowFailure ? 1 : 0
    }
    if ('skipped' in step) {
      skipped += step.skipped ? 1 : 0
    }

    return {
      allowfailures,
      errors: step.passed ? 1 : 0,
      failures: step.passed ? 1 : 0,
      skipped,
      tests: 1,
      warnings: 0,
    }
  }

  private getApiTestStep(step: MultiStep): {allowed_error: XMLError[]; error: XMLError[]} {
    const allowedError = []
    const error = []

    if (step.failure) {
      const xmlError = {
        $: {type: step.failure.code, step: step.name, allowFailure: `${step.allowFailure}`},
        _: step.failure.message,
      }
      if (step.allowFailure) {
        allowedError.push(xmlError)
      } else {
        error.push(xmlError)
      }
    }

    return {
      allowed_error: allowedError,
      error,
    }
  }

  private getBrowserStepStats(step: Step): StepStats {
    const errors = step.browserErrors ? step.browserErrors.length : 0

    return {
      allowfailures: step.allowFailure ? 1 : 0,
      errors: errors + (step.error ? 1 : 0),
      failures: step.error ? 1 : 0,
      skipped: step.skipped ? 1 : 0,
      tests: step.subTestStepDetails ? step.subTestStepDetails.length : 1,
      warnings: step.warnings ? step.warnings.length : 0,
    }
  }

  private getBrowserTestStep(
    stepDetail: Step
  ): {allowed_error: XMLError[]; browser_error: XMLError[]; error: XMLError[]; warning: XMLError[]} {
    const allowedError = []
    const browserError = []
    const error = []
    const warning = []
    if (stepDetail.browserErrors?.length) {
      browserError.push(
        ...stepDetail.browserErrors.map((e) => ({
          $: {type: e.type, name: e.name, step: stepDetail.description},
          _: e.description,
        }))
      )
    }

    if (stepDetail.error) {
      const xmlError = {
        $: {type: 'assertion', step: stepDetail.description, allowFailure: `${stepDetail.allowFailure}`},
        _: stepDetail.error,
      }
      if (stepDetail.allowFailure) {
        allowedError.push(xmlError)
      } else {
        error.push(xmlError)
      }
    }

    if (stepDetail.warnings?.length) {
      warning.push(
        ...stepDetail.warnings.map((w) => ({
          $: {type: w.type, step: stepDetail.description},
          _: w.message,
        }))
      )
    }

    return {
      allowed_error: allowedError,
      browser_error: browserError,
      error,
      warning,
    }
  }

  private getResultStats(result: Result, stats: StepStats = getDefaultStats()): StepStats {
    let stepsStats: StepStats[] = []
    if ('stepDetails' in result.result) {
      // It's a browser test.
      stepsStats = result.result.stepDetails
        .map((step) => {
          if (!step.subTestStepDetails) {
            return [step]
          }

          return [step, ...step.subTestStepDetails]
        })
        .reduce((acc, val) => acc.concat(val), [])
        .map(this.getBrowserStepStats)
    } else if ('steps' in result.result) {
      // It's an multistep API test
      stepsStats = result.result.steps.map(this.getApiStepStats)
    } else {
      stepsStats = [this.getApiStepStats(result.result)]
    }

    for (const stepStats of stepsStats) {
      stats.tests += stepStats.tests
      stats.errors += stepStats.errors
      stats.failures += stepStats.failures
      stats.skipped += stepStats.skipped
      stats.allowfailures += stepStats.allowfailures
      stats.warnings += stepStats.warnings
    }

    return stats
  }

  private getTestCase(result: Result, baseUrl: string): XMLTestCase {
    const test = result.test
    const resultOutcome = getResultOutcome(result)
    const resultUrl = getResultUrl(baseUrl, test, result.resultId)
    const passed = [ResultOutcome.Passed, ResultOutcome.PassedNonBlocking].includes(resultOutcome)

    return {
      $: {
        name: test.name,
        time: getResultDuration(result.result) / 1000,
        timestamp: new Date(result.timestamp).toISOString(),
        ...this.getResultStats(result),
      },
      allowed_error: [],
      browser_error: [],
      error: [],
      properties: {
        property: [
          {$: {name: 'check_id', value: result.test.public_id}},
          ...(isDeviceIdSet(result.result)
            ? [
                {$: {name: 'device', value: result.result.device?.id}},
                {$: {name: 'width', value: result.result.device?.width}},
                {$: {name: 'height', value: result.result.device?.height}},
              ]
            : []),
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          {$: {name: 'location', value: result.location}},
          {$: {name: 'message', value: test.message}},
          {$: {name: 'monitor_id', value: test.monitor_id}},
          {$: {name: 'passed', value: `${passed}`}},
          {$: {name: 'public_id', value: test.public_id}},
          {$: {name: 'result_id', value: result.resultId}},
          {$: {name: 'result_url', value: resultUrl}},
          ...('startUrl' in result.result ? [{$: {name: 'start_url', value: result.result.startUrl}}] : []),
          {$: {name: 'status', value: test.status}},
          {$: {name: 'tags', value: test.tags.join(',')}},
          {$: {name: 'timeout', value: `${result.timedOut}`}},
          {$: {name: 'type', value: test.type}},
        ].filter((prop) => prop.$.value),
      },
      testcase: [],
      warning: [],
    }
  }
}
