import {makeTerminalLink} from '@datadog/datadog-ci-base/helpers/utils'
import {Command, Option} from 'clipanion'

import {BaseCommand, RecursivePartial} from './base-command'
import {importTests} from './import-tests-lib'
import {ImportTestsCommandConfig} from './interfaces'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'
const datadogAppBaseUrl = 'https://app.datadoghq.com'

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#test-files`)
const $2 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/explore/#search`)
const $3 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/tests`)

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

  // TODO: Let's not reuse `files` as it has a different meaning.
  private files = Option.Array('-f,--files', {
    description: `The path to the Synthetic ${$1`test configuration file`} to which to append imported Local Test Definitions.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Public IDs of Synthetic tests to import.'})
  private testSearchQuery = Option.String('-s,--search', {
    description: `Use a ${$2`search query`} to select which Synthetic tests to import. Use the ${$3`Synthetic Tests list page's search bar`} to craft your query, then copy and paste it.`,
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
