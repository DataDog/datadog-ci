import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {BaseCommand} from '../..'

export class SbomUploadCommand extends BaseCommand {
  public static paths = [['sbom', 'upload']]

  public static usage = Command.Usage({
    category: 'Static Analysis',
    description: 'Upload SBOM files to Datadog.',
    details: `
      This command uploads SBOM files to Datadog for dependency tracking, vulnerability analysis, and compliance auditing.
    `,
    examples: [['Upload the SBOM file: sbom.json', 'datadog-ci sbom upload sbom.json']],
  })

  // BASE COMMAND START
  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  // BASE COMMAND END

  protected basePath = Option.String()
  protected serviceFromCli = Option.String('--service')
  protected env = Option.String('--env', 'ci')
  protected tags = Option.Array('--tags')
  protected gitPath = Option.String('--git-repository')
  protected debug = Option.Boolean('--debug')
  protected noCiTags = Option.Boolean('--no-ci-tags', false)

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
