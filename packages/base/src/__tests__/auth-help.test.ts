import type {CommandClass} from 'clipanion'

import {Cli} from 'clipanion'

import {commands} from '../cli'
import {AUTH_HELP} from '../helpers/auth'

const allCommands: CommandClass[] = Object.values(commands).flat() as CommandClass[]

const ORG_ACTION_COMMANDS = [
  'deployment correlate-image',
  'deployment gate',
  'gate evaluate',
  'sbom upload',
  'synthetics deploy-tests',
  'synthetics import-tests',
  'synthetics run-tests',
  'synthetics upload-application',
]

const getPath = (commandClass: CommandClass) => (commandClass.paths?.[0] ?? []).join(' ')

describe('authentication in --help', () => {
  test.each(allCommands.map((commandClass) => [getPath(commandClass), commandClass]))(
    '%s documents its authentication requirements',
    (_path, commandClass) => {
      const cli = new Cli()
      cli.register(commandClass)

      // The rendered help wraps lines at 80 characters, so normalize whitespace before matching.
      const help = cli.usage(commandClass, {detailed: true}).replace(/\s+/g, ' ')

      expect(help).toContain('Authentication: ')
    }
  )

  test.each(ORG_ACTION_COMMANDS)('%s documents the access token and the identity mapping', (path) => {
    const commandClass = allCommands.find((c) => getPath(c) === path)

    expect(commandClass?.usage?.details).toContain(AUTH_HELP.orgAction)
  })
})
