/* eslint-disable @typescript-eslint/member-ordering */
import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {makeTerminalLink} from '../../helpers/utils'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'
const datadogAppBaseUrl = 'https://app.datadoghq.com'

// BASE COMMAND START
const $B1 = makeTerminalLink(`${datadogDocsBaseUrl}/account_management/api-app-keys`)
const $B2 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#global-configuration-file`
)
const $B3 = makeTerminalLink(`${datadogDocsBaseUrl}/getting_started/site/#access-the-datadog-site`)
// BASE COMMAND END

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#test-files`)
const $2 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/explore/#search`)
const $3 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/tests`)

export class ImportTestsCommand extends Command {
  public static paths = [['synthetics', 'import-tests']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Import the Main Test Definition from a Datadog scheduled test as a Local Test Definition.',
    details: `
      This command imports a Main Test Definition from a Datadog scheduled test as a Local Test Definition to be used in local development.
    `,
    examples: [
      [
        'Explicitly specify multiple tests to run',
        'datadog-ci synthetics import-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      ['Override the default glob pattern', 'datadog-ci synthetics import-tests -f test-file.synthetics.json'],
    ],
  })

  // BASE COMMAND START
  protected apiKey = Option.String('--apiKey', {
    description: `Your Datadog API key. This key is ${$B1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected appKey = Option.String('--appKey', {
    description: `Your Datadog application key. This key is ${$B1`created in your Datadog organization`} and should be stored as a secret.`,
  })
  protected configPath = Option.String('--config', {
    description: `The path to the ${$B2`global configuration file`} that configures datadog-ci.`,
  })
  protected datadogSite = Option.String('--datadogSite', {
    description: `Your Datadog site. Possible values are listed ${$B3`in this table`}.`,
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  // BASE COMMAND END

  // TODO: Let's not reuse `files` as it has a different meaning.
  public files = Option.Array('-f,--files', {
    description: `The path to the Synthetic ${$1`test configuration file`} to which to append imported Local Test Definitions.`,
  })
  public publicIds = Option.Array('-p,--public-id', {description: 'Public IDs of Synthetic tests to import.'})
  public testSearchQuery = Option.String('-s,--search', {
    description: `Use a ${$2`search query`} to select which Synthetic tests to import. Use the ${$3`Synthetic Tests list page's search bar`} to craft your query, then copy and paste it.`,
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
