import {stripVTControlCharacters} from 'util'

import type {CommandClass, Cli} from 'clipanion'

import {Command} from 'clipanion'

import {commands} from '../cli'
import {AUTH_HELP, AUTH_REQUIREMENTS, CliWithAuthHelp, formatAuthHelp} from '../helpers/auth'

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

const renderHelp = (commandClass: CommandClass, cli: Cli = new CliWithAuthHelp()) => {
  cli.register(commandClass)

  return stripVTControlCharacters(cli.usage(commandClass, {colored: false, detailed: true}))
}

const getAuthenticationSection = (help: string) => help.split('\nAuthentication\n\n')[1]?.split('\nExamples\n')[0]

describe('authentication in --help', () => {
  test.each(allCommands.map((commandClass) => [getPath(commandClass), commandClass]))(
    '%s has an authentication requirement and shows it in an Authentication section',
    (path, commandClass) => {
      expect(AUTH_REQUIREMENTS[path]).toBeDefined()

      const section = getAuthenticationSection(renderHelp(commandClass))
      expect(section).toMatch(/^This command /)
      expect(section).toContain('See\nhttps://github.com/DataDog/datadog-ci#authentication')
    }
  )

  test.each(ORG_ACTION_COMMANDS)('%s documents the access token and the identity mapping', (path) => {
    const commandClass = allCommands.find((c) => getPath(c) === path)!

    expect(AUTH_REQUIREMENTS[path]).toStrictEqual({kind: 'orgAction'})
    expect(getAuthenticationSection(renderHelp(commandClass))).toBe(
      stripVTControlCharacters(formatAuthHelp(AUTH_HELP.orgAction))
    )
  })

  test('the section comes after Details and before Examples, with Clipanion header style', () => {
    const sbomUpload = allCommands.find((c) => getPath(c) === 'sbom upload')!
    const cli = new CliWithAuthHelp()
    cli.register(sbomUpload)
    const help = cli.usage(sbomUpload, {colored: true, detailed: true})

    expect(help).toContain(cli.format(true).header('Authentication'))
    const plain = stripVTControlCharacters(help)
    expect(plain.indexOf('━━━ Details')).toBeLessThan(plain.indexOf('━━━ Authentication'))
    expect(plain.indexOf('━━━ Authentication')).toBeLessThan(plain.indexOf('━━━ Examples'))
  })

  test('the section is not added to non-detailed usage or to commands without a requirement', () => {
    class UnknownCommand extends Command {
      public static paths = [['unknown', 'command']]
      public static usage = Command.Usage({details: 'Something else.'})
      public async execute() {}
    }
    const sbomUpload = allCommands.find((c) => getPath(c) === 'sbom upload')!
    const cli = new CliWithAuthHelp()
    cli.register(sbomUpload)

    expect(renderHelp(UnknownCommand)).not.toContain('Authentication')
    expect(stripVTControlCharacters(cli.usage(sbomUpload, {colored: false}))).not.toContain('Authentication')
    expect(sbomUpload.usage?.details).not.toContain('Authentication')
  })

  test('long lines wrap at 80 characters without splitting a terminal link', () => {
    const link =
      '\u001B]8;;https://docs.datadoghq.com/account_management/workload_identity_federation/\u0007WIF\u001B]8;;\u0007'
    const text = `${'word '.repeat(15)}${link} ${'word '.repeat(5)}`
    const lines = formatAuthHelp(text).trimEnd().split('\n')

    expect(lines.every((line) => stripVTControlCharacters(line).length <= 80)).toBe(true)
    expect(lines.some((line) => line.includes(link))).toBe(true)
  })
})
