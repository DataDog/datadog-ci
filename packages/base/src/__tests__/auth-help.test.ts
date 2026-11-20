import type {CommandClass} from 'clipanion'

import {Cli, Command} from 'clipanion'

import {commands} from '../cli'
import {AUTH_HELP, AUTH_REQUIREMENTS, withAuthHelp} from '../helpers/auth'

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

const renderHelp = (commandClass: CommandClass) => {
  const cli = new Cli()
  cli.register(commandClass)

  // The rendered help wraps lines at 80 characters, so normalize whitespace before matching.
  return cli.usage(commandClass, {detailed: true}).replace(/\s+/g, ' ')
}

describe('authentication in --help', () => {
  test.each(allCommands.map((commandClass) => [getPath(commandClass), commandClass]))(
    '%s has an authentication requirement and shows it in --help',
    (path, commandClass) => {
      expect(AUTH_REQUIREMENTS[path]).toBeDefined()

      expect(renderHelp(withAuthHelp(commandClass))).toContain('Authentication: ')
    }
  )

  test.each(ORG_ACTION_COMMANDS)('%s documents the access token and the identity mapping', (path) => {
    const commandClass = allCommands.find((c) => getPath(c) === path)!

    expect(AUTH_REQUIREMENTS[path]).toStrictEqual({kind: 'orgAction'})
    expect(withAuthHelp(commandClass).usage?.details).toContain(AUTH_HELP.orgAction)
  })

  test('withAuthHelp appends the paragraph once', () => {
    class SbomLikeCommand extends Command {
      public static paths = [['sbom', 'upload']]
      public static usage = Command.Usage({details: 'Uploads SBOM files.'})
      public async execute() {}
    }

    withAuthHelp(SbomLikeCommand)
    withAuthHelp(SbomLikeCommand)

    expect(SbomLikeCommand.usage.details).toBe(`Uploads SBOM files.\n\n${AUTH_HELP.orgAction}\n`)
  })

  test('withAuthHelp creates the usage when a command has none', () => {
    class VersionLikeCommand extends Command {
      public static paths = [['version']]
      public async execute() {}
    }

    withAuthHelp(VersionLikeCommand)

    expect(VersionLikeCommand.usage?.details).toBe(AUTH_HELP.none)
  })

  test('withAuthHelp leaves commands without a requirement unchanged', () => {
    class UnknownCommand extends Command {
      public static paths = [['unknown', 'command']]
      public static usage = Command.Usage({details: 'Something else.'})
      public async execute() {}
    }

    withAuthHelp(UnknownCommand)

    expect(UnknownCommand.usage.details).toBe('Something else.')
  })
})
