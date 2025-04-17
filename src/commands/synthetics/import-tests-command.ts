import {Command, Option} from 'clipanion'
import terminalLink from 'terminal-link'

import {BaseCommand, RecursivePartial} from './base-command'
import {importTests} from './import-tests-lib'
import {ImportTestsCommandConfig} from './interfaces'

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)

export class ImportTestsCommand extends BaseCommand {
  public static paths = [['synthetics', 'import-tests']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Import the Main Test Definition from a Datadog scheduled tests as a Local Test Definitions.',
    details: `
      This command imports a Main Test Definition from a Datadog scheduled tests as a Local Test Definitions to be used in local development.
    `,
    examples: [
      [
        'Explicitly specify multiple tests to run',
        'datadog-ci synthetics import-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      ['Override the default glob pattern', 'datadog-ci synthetics import-tests -f test-file.synthetics.json'],
    ],
  })

  protected config: ImportTestsCommandConfig = ImportTestsCommand.getDefaultConfig()

  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test files ${$2('configuration files')}} and write to this file.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify a test to import.'})
  private testSearchQuery = Option.String('-s,--search', {
    description: 'Pass a query to select which Synthetic tests to run.',
  })

  public static getDefaultConfig(): ImportTestsCommandConfig {
    return {
      ...super.getDefaultConfig(),
      files: [],
      publicIds: [],
      testSearchQuery: '',
    }
  }

  public async execute() {
    // populate the config
    await this.setup()

    try {
      await importTests(this.reporter, this.config)
    } catch (error) {
      this.logger.error(`Error: ${error.message}`)

      return 1
    }
  }

  protected resolveConfigFromEnv(): RecursivePartial<ImportTestsCommandConfig> {
    return {
      ...super.resolveConfigFromEnv(),
      files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
      publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
      testSearchQuery: process.env.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<ImportTestsCommandConfig> {
    return {
      ...super.resolveConfigFromCli(),
      files: this.files,
      publicIds: this.publicIds,
      testSearchQuery: this.testSearchQuery,
    }
  }
}
