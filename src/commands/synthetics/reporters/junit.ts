import c from 'chalk'
import {promises as fs} from 'fs'
import {Writable} from 'stream'
import {Builder} from 'xml2js'

import {
  ApiTestResult,
  InternalTest,
  LocationsMapping,
  MultiStep,
  PollResult,
  Reporter,
  Step,
  Vitals,
} from '../interfaces'
import {RunTestCommand} from '../run-test'
import {getResultDuration} from '../utils'

interface Stats {
  allowfailures: number
  errors: number
  failures: number
  skipped: number
  tests: number
  warnings: number
}

interface XMLRunProperties extends Stats {
  name: string
}

interface XMLRun {
  $: XMLRunProperties
  testsuite: XMLSuite[]
}

interface XMLSuiteProperties extends Stats {
  name: string
  time: number | undefined
  timestamp: number
}

interface XMLSuite {
  $: XMLSuiteProperties
  properties: {
    property: {$: {name: string; value: any}}[]
  }
  // These are singular for a better display in the XML format of the report.
  browser_error?: XMLError[]
  error: XMLError[]
  warning?: XMLError[]
  testcase: XMLStep[]
}

interface XMLStepProperties extends Stats {
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

interface XMLJSON {
  testsuites: {
    $: {name: string}
    testsuite: XMLRun[]
  }
}

interface XMLError {
  $: {type: string; [key: string]: string}
  _: string
}

export const getDefaultStats = (): Stats => ({
  allowfailures: 0,
  errors: 0,
  failures: 0,
  skipped: 0,
  tests: 0,
  warnings: 0,
})

// Return the stats from a given object
// based on getDefaultStats
const getStats = (obj: Stats): Stats => {
  const baseStats = getDefaultStats()
  for (const entry of Object.entries(baseStats)) {
    const [key, value] = entry as [keyof Stats, number]
    baseStats[key] = value || baseStats[key]
  }

  return baseStats
}

export class JUnitReporter implements Reporter {
  private builder: Builder
  private destination: string
  private json: XMLJSON
  private write: Writable['write']

  constructor(command: RunTestCommand) {
    this.write = command.context.stdout.write.bind(command.context.stdout)
    this.destination = command.jUnitReport!
    if (!this.destination.endsWith('.xml')) {
      this.destination += '.xml'
    }
    this.builder = new Builder()
    this.json = {
      testsuites: {$: {name: command.runName || 'Undefined run'}, testsuite: []},
    }
  }

  public async runEnd() {
    // Write the file
    try {
      const xml = this.builder.buildObject(this.json)
      await fs.writeFile(this.destination, xml, 'utf8')
      this.write(`✅ Created a jUnit report at ${c.bold.green(this.destination)}\n`)
    } catch (e) {
      this.write(`❌ Couldn't write the report to ${c.bold.green(this.destination)}:\n${e.toString()}\n`)
    }
  }

  public testEnd(test: InternalTest, results: PollResult[], baseUrl: string, locations: LocationsMapping) {
    const suiteRunName = test.suite || 'Undefined suite'
    let suiteRun = this.json.testsuites.testsuite.find((suite: XMLRun) => suite.$.name === suiteRunName)

    if (!suiteRun) {
      suiteRun = {
        $: {name: suiteRunName, ...getDefaultStats()},
        testsuite: [],
      }
      this.json.testsuites.testsuite.push(suiteRun as XMLRun)
    }

    // Update stats for the suite.
    suiteRun.$ = {
      ...suiteRun.$,
      ...this.getSuiteStats(results, getStats(suiteRun.$)),
    }

    for (const result of results) {
      const testSuite: XMLSuite = this.getTestSuite(test, result, locations)

      if ('stepDetails' in result.result) {
        // It's a browser test.
        for (const stepDetail of result.result.stepDetails) {
          const {browser_error, error, warning} = this.getBrowserTestStep(stepDetail)
          testSuite.browser_error = browser_error
          testSuite.error = error
          testSuite.warning = warning
        }
      } else if ('steps' in result.result) {
        // It's a multistep test.
        for (const step of result.result.steps) {
          const {error} = this.getApiTestStep(step)
          testSuite.error = error
        }
      }

      suiteRun.testsuite.push(testSuite)
    }
  }

  private getResultStats(result: PollResult, stats: Stats | undefined = getDefaultStats()): Stats {
    let stepsStats: Stats[] = []
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

  private getApiTestStep(step: MultiStep): {error: XMLError[]} {
    const error: XMLError[] = []

    if (step.failure) {
      error.push({$: {type: step.failure.code, step: step.name}, _: step.failure.message})
    }

    return {
      error,
    }
  }

  private getBrowserTestStep(stepDetail: Step): {browser_error: XMLError[]; error: XMLError[]; warning: XMLError[]} {
    const browser_error = []
    const error = []
    const warning = []
    if (stepDetail.browserErrors?.length) {
      browser_error.push(
        ...stepDetail.browserErrors.map((error) => ({
          $: {type: error.type, name: error.name, step: stepDetail.description},
          _: error.description,
        }))
      )
    }

    if (stepDetail.error) {
      error.push({
        $: {type: 'assertion', step: stepDetail.description},
        _: stepDetail.error,
      })
    }

    if (stepDetail.warnings?.length) {
      warning.push(
        ...stepDetail.warnings.map((warning) => ({
          $: {type: warning.type, step: stepDetail.description},
          _: warning.message,
        }))
      )
    }

    return {
      browser_error,
      error,
      warning,
    }
  }

  private getBrowserStepStats(step: Step): Stats {
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

  private getApiStepStats(step: MultiStep | ApiTestResult): Stats {
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

  private getSuiteStats(results: PollResult[], stats: Stats | undefined = getDefaultStats()): Stats {
    for (const result of results) {
      stats = this.getResultStats(result, stats)
    }

    return stats
  }

  private getTestSuite(test: InternalTest, result: PollResult, locations: LocationsMapping): XMLSuite {
    return {
      $: {
        name: test.name,
        time: getResultDuration(result.result) / 1000,
        timestamp: result.timestamp,
        ...this.getResultStats(result),
      },
      browser_error: [],
      error: [],
      properties: {
        property: [
          {$: {name: 'status', value: test.status}},
          {$: {name: 'public_id', value: test.public_id}},
          {$: {name: 'check_id', value: result.check_id}},
          {$: {name: 'result_id', value: result.resultID}},
          {$: {name: 'type', value: test.type}},
          {$: {name: 'message', value: test.message}},
          {$: {name: 'monitor_id', value: test.monitor_id}},
          {$: {name: 'tags', value: test.tags.join(',')}},
          {$: {name: 'location', value: locations[result.dc_id]}},
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
          ...('startUrl' in result.result ? [{$: {name: 'start_url', value: result.result.startUrl}}] : []),
          ...('device' in result.result
            ? [
                {$: {name: 'device', value: result.result.device.id}},
                {$: {name: 'width', value: result.result.device.width}},
                {$: {name: 'height', value: result.result.device.height}},
              ]
            : []),
        ].filter((prop) => prop.$.value),
      },
      testcase: [],
      warning: [],
    }
  }
}
