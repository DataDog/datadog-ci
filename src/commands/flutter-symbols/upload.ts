// Disabling no-unused-variable temporarily so certain private methods
// can remain in while this feature is in progress
// tslint:disable: no-unused-variable
import fs from 'fs'

import {Command} from 'clipanion'
import yaml from 'js-yaml'
import {
  renderArgumentMissingError,
  renderDartSymbolsLocationRequiredError,
  renderGitWarning,
  renderInvalidPubspecError,
  renderMissingAndroidMappingFile,
  renderMissingPubspecError,
  renderPubspecMissingVersionError,
} from './renderer'

import glob from 'glob'
import {MultipartPayload, MultipartValue} from '../../helpers/upload'
import {getRepositoryData, RepositoryData} from '../../helpers/git/format-git-sourcemaps-data'
import {buildPath, performSubCommand} from '../../helpers/utils'
import * as dsyms from '../dsyms/upload'
import {newSimpleGit} from '../git-metadata/git'
import {MappingMetadata, MAPPING_TYPE_JVM_MAPPING} from './interfaces'

export class UploadCommand extends Command {
  public static usage = Command.Usage({
    description: '',
    details: `
        `,
    examples: [],
  })

  private androidMapping = false
  private androidMappingLocation?: string
  private cliVersion: string
  private dartSymbols = false
  private dartSymbolsLocation?: string
  private disableGit = false
  private dryRun = false
  private flavor = 'release'
  private gitData?: RepositoryData
  private iosDsyms = false
  private iosDsymsLocation?: string
  private pubspecLocation = './pubspec.yaml'
  private repositoryUrl?: string
  private serviceName!: string
  private version?: string

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

    if (!this.version && (await this.parsePubspec(this.pubspecLocation))) {
      return 1
    }

    if (!this.disableGit) {
      this.gitData = await this.getGitMetadata()
    }

    if (await this.performDsymUpload()) {
      return 1
    }

    if (await this.performAndroidMappingUpload()) {
      return 1
    }

    return 0
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

  private getAndroidMetadata(): MappingMetadata {
    return {
      cli_version: this.cliVersion,
      git_commit_sha: this.gitData?.hash,
      git_repository_url: this.gitData?.remote,
      service: this.serviceName,
      type: MAPPING_TYPE_JVM_MAPPING,
      variant: this.flavor,
      version: this.version!,
    }
  }

  private getFlutterSymbolFiles(dartSymbolLocation: string): string[] {
    const symbolPaths = glob.sync(buildPath(dartSymbolLocation, '*.symbols'))

    return symbolPaths
  }

  private async getGitMetadata(): Promise<RepositoryData | undefined> {
    try {
      return await getRepositoryData(await newSimpleGit(), this.repositoryUrl)
    } catch (e) {
      this.context.stdout.write(renderGitWarning(e))
    }

    return undefined
  }

  private async parsePubspec(pubspecLocation: string): Promise<number> {
    if (!fs.existsSync(pubspecLocation)) {
      this.context.stderr.write(renderMissingPubspecError(pubspecLocation))

      return 1
    }

    try {
      const doc = yaml.load(fs.readFileSync(pubspecLocation, 'utf8')) as any
      if (doc.version) {
        this.version = doc.version
      } else {
        this.context.stderr.write(renderPubspecMissingVersionError(pubspecLocation))

        return 1
      }
    } catch (e) {
      this.context.stderr.write(renderInvalidPubspecError(pubspecLocation))

      return 1
    }

    return 0
  }

  private async performAndroidMappingUpload(): Promise<number> {
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
}

UploadCommand.addPath('flutter-symbols', 'upload')
UploadCommand.addOption('flavor', Command.String('--flavor'))
UploadCommand.addOption('dartSymbols', Command.Boolean('--dart-symbols'))
UploadCommand.addOption('dartSymbolsLocation', Command.String('--dart-symbols-location'))
UploadCommand.addOption('iosDsyms', Command.Boolean('--ios-dsyms'))
UploadCommand.addOption('iosDsymsLocation', Command.String('--ios-dsyms-location'))
UploadCommand.addOption('androidMapping', Command.Boolean('--android-mapping'))
UploadCommand.addOption('androidMappingLocation', Command.String('--android-mapping-location'))
UploadCommand.addOption('pubspecLocation', Command.String('--pubspec'))
UploadCommand.addOption('serviceName', Command.String('--service-name'))
UploadCommand.addOption('version', Command.String('--version'))
UploadCommand.addOption('dryRun', Command.Boolean('--dry-run'))
UploadCommand.addOption('disableGit', Command.Boolean('--disable-git'))
UploadCommand.addOption('repositoryURL', Command.String('--repository-url'))
