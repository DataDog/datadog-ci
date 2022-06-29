import {Command} from 'clipanion'
import {renderArgumentMissingError, renderDartSymbolsLocationRequiredError} from './renderer'

import * as dsyms from '../dsyms/upload'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: '',
    details: `
        `,
    examples: [],
  })

  private flavor: string = 'release'
  private dartSymbols: boolean = false
  private dartSymbolsLocation?: string
  private iosDsyms: boolean = false
  private iosDsymsLocation?: string
  private androidMapping: boolean = false
  private androidMappintLocation?: string
  private serviceName!: string
  private version?: string
  private dryRun: boolean = false

  public async execute() {
    if (!this.serviceName) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))

      return 1
    }

    if (this.dartSymbols && !this.dartSymbolsLocation) {
      this.context.stderr.write(renderDartSymbolsLocationRequiredError())

      return 1
    }

    if (await this.performDsymUpload()) {
      return 1
    }

    return 0
  }

  private async performDsymUpload(): Promise<0 | 1> {
    if (!this.iosDsyms && !this.iosDsymsLocation) {
      // Not asked for. we're done
      return 0
    }

    const dsymsUpload = new dsyms.UploadCommand()
    dsymsUpload.cli = this.cli
    dsymsUpload.context = this.context

    const exitCode = await dsymsUpload.execute()

    return exitCode
  }
}

UploadCommand.addPath('flutter-symbols', 'upload')
UploadCommand.addOption('flavor', Command.String('--flavor'))
UploadCommand.addOption('dartSymbols', Command.Boolean('--dart-symbols'))
UploadCommand.addOption('dartSymbolsLocation', Command.String('--dart-symbols-location'))
UploadCommand.addOption('iosDsyms', Command.Boolean('--ios-dsyms'))
UploadCommand.addOption('iosDsymsLocation', Command.String('--ios-dsyms-location'))
UploadCommand.addOption('androidMapping', Command.Boolean('--android-mapping'))
UploadCommand.addOption('androidMappingLocation', Command.String('--android-mapping-location'))
UploadCommand.addOption('serviceName', Command.String('--service-name'))
UploadCommand.addOption('version', Command.String('--version'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
