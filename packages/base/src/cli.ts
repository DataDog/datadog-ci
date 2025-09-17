import {CommandClass} from 'clipanion'

import {CloudRunFlareCommand} from './commands/cloud-run/flare'
import {InstrumentCommand as CloudRunInstrumentCommand} from './commands/cloud-run/instrument'
import {UninstrumentCommand as CloudRunUninstrumentCommand} from './commands/cloud-run/uninstrument'
import {UploadCommand} from './commands/git-metadata/upload'
import {SarifUploadCommand} from './commands/sarif/upload-command'
import {SbomUploadCommand} from './commands/sbom/upload-command'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'

export const baseCommands: Record<string, CommandClass[]> = {
  sarif: [SarifUploadCommand],
  sbom: [SbomUploadCommand],
  synthetics: [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
  'cloud-run': [CloudRunInstrumentCommand, CloudRunUninstrumentCommand, CloudRunFlareCommand],
  'git-metadata': [UploadCommand],
}
