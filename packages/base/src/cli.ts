/* eslint-disable quote-props */
import {CommandClass} from 'clipanion'

import {UploadCommand} from './commands/git-metadata/upload'
import {CheckCommand} from './commands/plugin/check-command'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'

// prettier-ignore
export const commands: Record<string, CommandClass[]> = {
  'git-metadata': [UploadCommand],
  'plugin': [CheckCommand],
  'synthetics': [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
}
