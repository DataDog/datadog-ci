import {promises as fs} from 'fs'
import {Writable} from 'stream'
import {Builder} from 'xml2js'

import {ConfigOverride, ExecutionRule, LocationsMapping, PollResult, Reporter, Step, Summary, Test} from '../interfaces'
import {RunTestCommand} from '../run-test'

export class JUnitReporter implements Reporter {
  private json: any
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

  private getStats(result: PollResult) {
    const details = result.result.stepDetails
    const steps = result.result.stepDetails
      .map((step) => {
        if (!step.subTestStepDetails) {
          return [step]
        }
        return [step, ...step.subTestStepDetails]
      })
      .reduce((acc, val) => acc.concat(val), [])
    console.log(steps)
    const tests = 0
    const errors = 0
    const failures = 0
    const skipped = 0
    const allowfailure = 0
    const assertions = 0
    const warnings = 0

    return {}
  }

  private getTestSuite(test: Test, result: PollResult) {
    return {
      $: {name: test.name, duration: result.result.duration},
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

  private getStep(stepDetail: Step) {
    const step: any = {
      $: {
        name: stepDetail.description,
        skipped: stepDetail.skipped,
        time: stepDetail.duration,
        allowfailure: stepDetail.allowFailure,
        url: stepDetail.url,
        type: stepDetail.type,
      },
      testcase: [],
      error: [],
      warning: [],
    }

    if (stepDetail.subTestStepDetails && stepDetail.subTestStepDetails.length) {
      // TODO Maybe add subStepPublicId somewhere in the report.
      for (const subStepDetail of stepDetail.subTestStepDetails) {
        step.testcase.push(this.getStep(subStepDetail))
      }
    }

    if (stepDetail.vitalsMetrics) {
      step.vitals = {
        $: stepDetail.vitalsMetrics,
      }
    }

    if (stepDetail.browserErrors?.length) {
      step.error.push(
        ...stepDetail.browserErrors.map((error) => ({
          $: {type: error.type, name: error.name},
          _: error.description,
        }))
      )
    }

    if (stepDetail.error) {
      step.error.push({
        $: {type: 'assertion'},
        _: stepDetail.error,
      })
    }

    if (stepDetail.warnings?.length) {
      step.warning.push(
        ...stepDetail.warnings.map((warning) => ({
          $: {type: warning.type},
          _: warning.message,
        }))
      )
    }

    return step
  }

  public testEnd(test: Test, results: PollResult[]) {
    const suitename = test.suite || 'Undefined suite'

    let suite = this.json.testsuites.testsuite.find((suite: any) => suite.$.name === suitename)
    if (!suite) {
      suite = {
        $: {name: suitename},
        testsuite: [],
      }
      this.json.testsuites.testsuite.push(suite)
    }

    for (const result of results) {
      const testSuite: any = this.getTestSuite(test, result)
      const stats = this.getStats(result)

      for (const stepDetail of result.result.stepDetails) {
        testSuite.testcase.push(this.getStep(stepDetail))
      }

      suite.testsuite.push(testSuite)
    }

    console.log('RESULTS:', JSON.stringify(results, null, 2))
    console.log('TEST:', JSON.stringify(test, null, 2))
  }

  public async runEnd() {
    try {
      await fs.writeFile(this.destination.replace(/\.xml$/, '.json'), JSON.stringify(this.json, null, 4), 'utf8')
      const xml = this.builder.buildObject(this.json)
      await fs.writeFile(this.destination, xml, 'utf8')
      this.write(`Created the jUnit report to ${this.destination}`)
    } catch (e) {
      this.write(`Couldn't write the report to ${this.destination}:\n`)
      console.log(e)
      this.write(e.toString())
    }
  }
}
