import type {Reporter, ReporterContext, Result} from '../interfaces'

import {FileReporter} from './file'

export interface Args {
  context: ReporterContext
  jsonReport?: string
}

export class JSONReporter extends FileReporter implements Reporter {
  private readonly results: Result[] = []

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

    this.results.push(result)
  }

  public runEnd() {
    const fileContent = {
      results: this.results,
    }
    const jsonContent = JSON.stringify(fileContent, undefined, 2)
    this.writeReportToFile(jsonContent)
  }
}
