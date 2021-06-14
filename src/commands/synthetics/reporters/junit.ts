import {promises as fs} from 'fs'
import {Writable} from 'stream'
import {Builder} from 'xml2js'
import c from 'chalk'

import {
  ConfigOverride,
  ExecutionRule,
  LocationsMapping,
  PollResult,
  Reporter,
  Step,
  Summary,
  Test,
  Vitals,
} from '../interfaces'
import {RunTestCommand} from '../run-test'

interface Stats {
  tests: number
  errors: number
  failures: number
  skipped: number
  allowfailures: number
  assertions: number
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
  timestamp: number
  time: number
}

interface XMLSuite {
  $: XMLSuiteProperties
  properties: {
    property: {$: {name: string; value: any}}[]
  }
  testcase: XMLStep[]
}

interface XMLStepProperties extends Stats {
  name: string
  is_skipped: boolean
  time: number
  allow_failure: boolean
  url: string
  type: string
  substep_public_id?: string
}

interface XMLStep {
  $: XMLStepProperties
  browser_error: {$: {type: string; name: string}; _: string}[]
  error: {$: {type: 'assertion'}; _: string}[]
  vitals?: {$: Vitals}[]
  warning: {$: {type: string}; _: string}[]
}

interface XMLJSON {
  testsuites: {
    $: {name: string}
    testsuite: XMLRun[]
  }
}

const getDefaultStats = (): Stats => ({
  tests: 0,
  errors: 0,
  failures: 0,
  skipped: 0,
  allowfailures: 0,
  assertions: 0,
  warnings: 0,
})

// Return the stats from a given object
// based on getDefaultStats
const getStats = (obj: any): Stats => {
  const baseStats = getDefaultStats()
  for (const entry of Object.entries(baseStats)) {
    const [key] = entry as [keyof Stats, number]
    baseStats[key] = obj[key] || baseStats[key]
  }
  return baseStats
}

export class JUnitReporter implements Reporter {
  private json: XMLJSON
  private destination: string
  private write: Writable['write']
  private builder: Builder

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

  private getStepStats(step: Step): Stats {
    const errors = step.browserErrors ? step.browserErrors.length : 0
    return {
      tests: step.subTestStepDetails ? step.subTestStepDetails.length : 1,
      errors: errors + (step.error ? 1 : 0),
      failures: step.error ? 1 : 0,
      skipped: step.skipped ? 1 : 0,
      allowfailures: step.allowFailure ? 1 : 0,
      assertions: step.subTestStepDetails ? step.subTestStepDetails.length : 1,
      warnings: step.warnings ? step.warnings.length : 0,
    }
  }

  private getResultStats(result: PollResult, stats: Stats | undefined = getDefaultStats()): Stats {
    const steps = result.result.stepDetails
      .map((step) => {
        if (!step.subTestStepDetails) {
          return [step]
        }
        return [step, ...step.subTestStepDetails]
      })
      .reduce((acc, val) => acc.concat(val), [])

    for (const step of steps) {
      const stepStats = this.getStepStats(step)

      stats.tests += stepStats.tests
      stats.errors += stepStats.errors
      stats.failures += stepStats.failures
      stats.skipped += stepStats.skipped
      stats.allowfailures += stepStats.allowfailures
      stats.assertions += stepStats.assertions
      stats.warnings += stepStats.warnings
    }

    return stats
  }

  private getSuiteStats(results: PollResult[], stats: Stats | undefined = getDefaultStats()): Stats {
    for (const result of results) {
      stats = this.getResultStats(result, stats)
    }
    return stats
  }

  private getTestSuite(test: Test, result: PollResult): XMLSuite {
    return {
      $: {
        name: test.name,
        timestamp: result.timestamp,
        time: result.result.duration! / 1000,
        ...this.getResultStats(result),
      },
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
          {$: {name: 'locations', value: test.locations.join(',')}},
          {$: {name: 'start_url', value: result.result.startUrl}},
          {$: {name: 'device', value: result.result.device.id}},
          {$: {name: 'width', value: result.result.device.width}},
          {$: {name: 'height', value: result.result.device.height}},
          {$: {name: 'execution_rule', value: test.options.ci?.executionRule}},
        ],
      },
      testcase: [],
    }
  }

  private getStep(stepDetail: Step): XMLStep[] {
    const mainStep: XMLStep = {
      $: {
        name: stepDetail.description,
        is_skipped: stepDetail.skipped,
        time: stepDetail.duration / 1000,
        allow_failure: stepDetail.allowFailure,
        url: stepDetail.url,
        type: stepDetail.type,
        substep_public_id: stepDetail.subTestPublicId,
        ...this.getStepStats(stepDetail),
      },
      browser_error: [],
      error: [],
      warning: [],
    }
    const steps = [mainStep]

    if (stepDetail.subTestStepDetails && stepDetail.subTestStepDetails.length) {
      for (const subStepDetail of stepDetail.subTestStepDetails) {
        steps.push(...this.getStep(subStepDetail))
      }
    }

    if (stepDetail.vitalsMetrics) {
      mainStep.vitals = stepDetail.vitalsMetrics.map((vital) => ({$: vital}))
    }

    if (stepDetail.browserErrors?.length) {
      mainStep.browser_error.push(
        ...stepDetail.browserErrors.map((error) => ({
          $: {type: error.type, name: error.name},
          _: error.description,
        }))
      )
    }

    if (stepDetail.error) {
      mainStep.error.push({
        $: {type: 'assertion'},
        _: stepDetail.error,
      })
    }

    if (stepDetail.warnings?.length) {
      mainStep.warning.push(
        ...stepDetail.warnings.map((warning) => ({
          $: {type: warning.type},
          _: warning.message,
        }))
      )
    }

    return steps
  }

  public testEnd(test: Test, results: PollResult[]) {
    const suiteRunName = test.suite || 'Undefined suite'

    let suiteRun = this.json.testsuites.testsuite.find((suite: any) => suite.$.name === suiteRunName)
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
      const testSuite: XMLSuite = this.getTestSuite(test, result)

      for (const stepDetail of result.result.stepDetails) {
        testSuite.testcase.push(...this.getStep(stepDetail))
      }

      suiteRun.testsuite.push(testSuite)
    }
  }

  public async runEnd() {
    try {
      await fs.writeFile(this.destination.replace(/\.xml$/, '.json'), JSON.stringify(this.json, null, 4), 'utf8')
      const xml = this.builder.buildObject(this.json)
      await fs.writeFile(this.destination, xml, 'utf8')
      this.write(`✅ Created a jUnit report at ${c.bold.green(this.destination)}\n`)
    } catch (e) {
      this.write(`❌ Couldn't write the report to ${c.bold.green(this.destination)}:\n${e.toString()}\n`)
    }
  }
}
