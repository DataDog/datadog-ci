import fs from 'fs'

import type {ReporterContext} from '../interfaces'
import type {Writable} from 'stream'

import c from 'chalk'
import upath from 'upath'

type Args = {
  context: ReporterContext
  defaultExtension: string
  destination: string
  reportName: string
}

export abstract class FileReporter {
  protected destination: string
  protected write: Writable['write']
  private reportName: string

  constructor({context, defaultExtension, destination, reportName}: Args) {
    this.write = context.stdout.write.bind(context.stdout)
    this.destination = destination
    this.reportName = reportName

    if (!this.destination.endsWith(defaultExtension)) {
      this.destination += defaultExtension
    }
  }

  protected writeReportToFile(contents: string) {
    try {
      fs.mkdirSync(upath.dirname(this.destination), {recursive: true})
      fs.writeFileSync(this.destination, contents, 'utf8')
      this.write(`\n✅ Created a ${this.reportName} at ${c.bold.green(this.destination)}\n`)
    } catch (error) {
      this.write(`\n❌ Couldn't write the ${this.reportName} to ${c.bold.green(this.destination)}:\n${error}\n`)
    }
  }
}
