import {CommandClass} from 'clipanion'

import {CloudRunFlareCommand} from './commands/cloud-run/flare'
import {InstrumentCommand as CloudRunInstrumentCommand} from './commands/cloud-run/instrument'
import {UninstrumentCommand as CloudRunUninstrumentCommand} from './commands/cloud-run/uninstrument'
import {GateEvaluateCommand} from './commands/gate/evaluate-command'
import {UploadCommand} from './commands/git-metadata/upload'
import {LambdaFlareCommand} from './commands/lambda/flare'
import {InstrumentCommand as LambdaInstrumentCommand} from './commands/lambda/instrument'
import {UninstrumentCommand as LambdaUninstrumentCommand} from './commands/lambda/uninstrument'
import {SarifUploadCommand} from './commands/sarif/upload-command'
import {SbomUploadCommand} from './commands/sbom/upload-command'
import {InstrumentStepFunctionsCommand} from './commands/stepfunctions/instrument'
import {UninstrumentStepFunctionsCommand} from './commands/stepfunctions/uninstrument'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'
import {TagCommand} from './commands/tag/tag-command'

export const baseCommands: Record<string, CommandClass[]> = {
  sarif: [SarifUploadCommand],
  sbom: [SbomUploadCommand],
  synthetics: [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
  'cloud-run': [CloudRunInstrumentCommand, CloudRunUninstrumentCommand, CloudRunFlareCommand],
  lambda: [LambdaInstrumentCommand, LambdaUninstrumentCommand, LambdaFlareCommand],
  stepfunctions: [InstrumentStepFunctionsCommand, UninstrumentStepFunctionsCommand],
  'git-metadata': [UploadCommand],
  tag: [TagCommand],
  gate: [GateEvaluateCommand],
}
