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

export class SyntheticsRunLocalCommand extends BaseCommand {
  public static paths = [['synthetics', 'run-local']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Run a Synthetic browser test against a local or staging environment.',
    details: `
      This command fetches an existing Synthetics browser test, spins up a local worker in one-shot mode,
      applies an optional domain override to the starting URL, runs the test, and streams the result back.\n
      Chrome runs on the local machine via the synthetics-worker Docker image. Docker must be installed and running.\n
      https://docs.datadoghq.com/continuous_testing/cicd_integrations
    `,
    examples: [
      [
        'Run a test against localhost:3000',
        'datadog-ci synthetics run-local --test-id abc-def-ghi --override-domain localhost:3000',
      ],
      [
        'Run a test against a staging URL',
        'datadog-ci synthetics run-local --test-id abc-def-ghi --override-domain https://staging.example.internal',
      ],
      [
        'Run with TLS errors ignored (useful for self-signed certs)',
        'datadog-ci synthetics run-local --test-id abc-def-ghi --override-domain localhost:3000 --ignore-tls-errors',
      ],
    ],
  })

  public testId = Option.String('--test-id', {
    description: 'The public ID of the Synthetic test to run.',
    required: true,
  })

  public overrideDomain = Option.String('--override-domain', {
    description:
      'Replace the host in the test\'s starting URL. Accepts a host+port (e.g. `localhost:3000`) or a full origin (e.g. `https://staging.example.internal`). The path from the original URL is preserved.',
  })

  public ignoreTlsErrors = Option.Boolean('--ignore-tls-errors', false, {
    description: 'Ignore TLS/SSL certificate errors in the browser. Useful for staging environments with self-signed certificates.',
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

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
