import {CommandClass} from 'clipanion'

import {RunTestsCommand} from './commands/synthetics/run-tests-command'

export const baseCommands: Record<string, CommandClass[]> = {
  synthetics: [RunTestsCommand],
}
