/* eslint-disable @typescript-eslint/member-ordering */
import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {makeTerminalLink} from '../../helpers/utils'

import {BaseCommand} from '../..'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'

// BASE COMMAND START
const $B1 = makeTerminalLink(`${datadogDocsBaseUrl}/account_management/api-app-keys`)
const $B2 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#global-configuration-file`
)
const $B3 = makeTerminalLink(`${datadogDocsBaseUrl}/getting_started/site/#access-the-datadog-site`)
// BASE COMMAND END

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#test-files`)

export class SyntheticsDeployTestsCommand extends BaseCommand {
  public static paths = [['synthetics', 'deploy-tests']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Deploy Local Test Definitions as Main Test Definitions in Datadog.',
    details: `
      This command deploys Local Test Definitions as Main Test Definitions in Datadog, usually when a feature branch is merged or during a deployment.
    `,
    examples: [
      [
        'Explicitly specify the local test definitions to deploy',
        'datadog-ci synthetics deploy-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      [
        'Override the default glob pattern',
        'datadog-ci synthetics deploy-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json',
      ],
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

  public files = Option.Array('-f,--files', {
    description: `Glob patterns to detect Synthetic ${$1`test configuration files`}}.`,
  })
  public publicIds = Option.Array('-p,--public-id', {description: 'Public IDs of Synthetic tests to deploy.'})
  public subdomain = Option.String('--subdomain', {
    description:
      'The custom subdomain to access your Datadog organization. If your URL is `myorg.datadoghq.com`, the custom subdomain is `myorg`.',
  })
  public excludeFields = Option.Array('--exclude-field', {
    description:
      'Fields to exclude from partial updates, to avoid breaking Main Test Definitions with data specific to Local Test Definitions, like the Start URL. By default, all fields inside `config` are excluded.',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
