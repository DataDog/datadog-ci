import {CommandClass} from 'clipanion'

import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'

export const baseCommands: Record<string, CommandClass[]> = {
  synthetics: [RunTestsCommand, DeployTestsCommand],
}
