import type {Reporter, ReporterContext, Result} from '../interfaces'
import type {FieldPath} from '../utils/paths'

import {pickPaths} from '../utils/paths'

import {FileReporter} from './file'

export interface Args {
  context: ReporterContext
  jsonReport?: string
}

// As a starting point for GA, the JSON report exposes exactly the fields the JUnit report exposes (see
// `junit.ts`'s `getTestCase()`/`getSkippedTestCase()`) -- no more, no less. This list is intentionally
// separate from (not derived from) JUnit's own field-by-field construction, so the two are free to drift
// later if a JSON-only or JUnit-only field ever becomes necessary.
export const JSON_REPORTER_EXPOSED_FIELDS: readonly FieldPath[] = [
  // Test identity.
  'test.suite',
  'test.name',
  'test.type',
  'test.public_id',
  'test.options.ci.executionRule',
  'test.message',
  'test.monitor_id',
  'test.status',
  'test.tags',

  // Result identity and outcome.
  'resultId',
  'initialResultId',
  'executionRule',
  'passed',
  'timedOut',
  'duration',
  'location',
  'retries',
  'maxRetries',
  'device.id',
  'device.resolution.width',
  'device.resolution.height',
  'selectiveRerun.decision',
  'selectiveRerun.reason',
  'selectiveRerun.linked_result_id',

  // Server-side result payload.
  'result.finished_at',
  'result.start_url',
  'result.failure.code',
  'result.failure.message',

  // Browser test steps and multistep API test steps.
  'result.steps[*].status',
  'result.steps[*].allow_failure',
  'result.steps[*].description',
  'result.steps[*].name',
  'result.steps[*].failure.code',
  'result.steps[*].failure.message',
  'result.steps[*].browser_errors[*].type',
  'result.steps[*].browser_errors[*].name',
  'result.steps[*].browser_errors[*].description',
  'result.steps[*].warnings[*].type',
  'result.steps[*].warnings[*].message',
]

export class JSONReporter extends FileReporter implements Reporter {
  private readonly results: Partial<Result>[] = []

  constructor({context, jsonReport}: Args) {
    super({
      context,
      defaultExtension: '.json',
      destination: jsonReport!,
      reportName: 'JSON report',
    })
  }

  public resultEnd(result: Result) {
    if (result.isNonFinal) {
      return
    }

    this.results.push(pickPaths(result, JSON_REPORTER_EXPOSED_FIELDS))
  }

  public runEnd() {
    const fileContent = {
      results: this.results,
    }
    const jsonContent = JSON.stringify(fileContent, undefined, 2)
    this.writeReportToFile(jsonContent)
  }
}
