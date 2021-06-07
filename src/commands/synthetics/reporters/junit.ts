import {promises as fs} from 'fs'
import {Writable} from 'stream'
import {Builder} from 'xml2js'

import {ConfigOverride, ExecutionRule, LocationsMapping, PollResult, Reporter, Summary, Test} from '../interfaces'
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

  // public testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: ConfigOverride) {}

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
      const testSuite: any = {
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
            {$: {name: 'startUrl', value: result.result.startUrl}},
            {$: {name: 'device', value: result.result.device.id}},
            {$: {name: 'width', value: result.result.device.width}},
            {$: {name: 'height', value: result.result.device.height}},
            {$: {name: 'executionRule', value: test.options.ci?.executionRule}},
          ],
        },
        testcase: [],
      }

      for (const stepDetail of result.result.stepDetails) {
        const step: any = {
          $: {
            name: stepDetail.description,
            skipped: stepDetail.skipped,
            time: stepDetail.duration,
            allowfailure: stepDetail.allowFailure,
            url: stepDetail.url,
            type: stepDetail.type,
          },
        }
        if (stepDetail.browserErrors?.length) {
          step.error = []
          for (const error of stepDetail.browserErrors) {
            step.error.push({
              $: {type: error.type, name: error.name},
              _: error.description,
            })
          }
        }
        testSuite.testcase.push(step)
      }

      suite.testsuite.push(testSuite)
    }

    console.log('RESULTS:', JSON.stringify(results, null, 2))
    console.log('TEST:', JSON.stringify(test, null, 2))
  }

  public async runEnd() {
    try {
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
