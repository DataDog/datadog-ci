import fs from 'fs'

import {BaseContext, Command} from 'clipanion'
import {
  renderArgumentMissingError,
  renderDartSymbolsLocationRequiredError,
  renderMissingAndroidMappingFile,
} from './renderer'

import * as dsyms from '../dsyms/upload'
import {buildPath, performSubCommand} from '../../helpers/utils'
import glob from 'glob'
import {GitData, MappingMetadata, MAPPING_TYPE_JVM_MAPPING} from './interfaces'
import {MultipartPayload, MultipartValue} from '../../helpers/upload'

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
  private androidMappingLocation?: string
  private serviceName!: string
  private version?: string
  private dryRun: boolean = false

  // Non-arguments
  private cliVersion: string
  private gitData?: GitData

  constructor() {
    super()
    this.cliVersion = require('../../../package.json').version
  }

  public async execute() {
    if (!this.serviceName) {
      this.context.stderr.write(renderArgumentMissingError('service-name'))

      return 1
    }

    if (this.dartSymbols && !this.dartSymbolsLocation) {
      this.context.stderr.write(renderDartSymbolsLocationRequiredError())

      return 1
    }

    if (this.androidMapping && !this.androidMappingLocation) {
      this.androidMappingLocation = `./build/app/outputs/mapping/${this.flavor}/mapping.txt`
    }

    if (this.androidMappingLocation) {
      if (!fs.existsSync(this.androidMappingLocation)) {
        this.context.stderr.write(renderMissingAndroidMappingFile(this.androidMappingLocation))
        return 1
      }
    }

    if (await this.performDsymUpload()) {
      return 1
    }

    return 0
  }

  private async performDsymUpload(): Promise<number> {
    if (!this.iosDsyms && !this.iosDsymsLocation) {
      // Not asked for. we're done
      return 0
    }

    const symbolLocation = this.iosDsymsLocation ?? './build/ios/archive/Runner.xcarchive/dSYMs'

    const dsymUploadCommand = ['dsyms', 'upload', symbolLocation]
    if (this.dryRun) {
      dsymUploadCommand.push('--dry-run')
    }

    const exitCode = await performSubCommand(dsyms.UploadCommand, dsymUploadCommand, this.context)

    return exitCode
  }

  private getFlutterSymbolFiles(dartSymbolLocation: string): string[] {
    const symbolPaths = glob.sync(buildPath(dartSymbolLocation, '*.symbols'))

    return symbolPaths
  }

  private getAndroidMetadata(): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      service: this.serviceName,
      version: this.version!,
      variant: this.flavor,
      type: MAPPING_TYPE_JVM_MAPPING,
    }
  }

  private createAndroidMappingPayload(mappingFile: string): MultipartPayload {
    const metadata = this.getAndroidMetadata()

    const content = new Map<string, MultipartValue>([
      [
        'event',
        {
          options: {
            contentType: 'application/json',
            filename: 'event',
          },
          value: JSON.stringify(metadata),
        },
      ],
    ])

    return {
      content,
    }
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
