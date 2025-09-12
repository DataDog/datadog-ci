import {CommandClass} from 'clipanion'

import {GateEvaluateCommand} from './commands/gate/evaluate-command'
import {UploadCommand} from './commands/git-metadata/upload'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'

export const baseCommands: Record<string, CommandClass[]> = {
  gate: [GateEvaluateCommand],
  synthetics: [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
  'git-metadata': [UploadCommand],
}
