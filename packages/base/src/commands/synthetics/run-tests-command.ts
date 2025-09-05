/* eslint-disable @typescript-eslint/member-ordering */
import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'
import {makeTerminalLink} from '../../helpers/utils'
import * as validation from '../../helpers/validation'

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
const $2 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/settings/continuous-testing`)
const $3 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/explore/#search`)
const $4 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/tests`)
const $5 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/environments/proxy_firewall_vpn#what-is-the-testing-tunnel`
)
const $6 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/mobile_app_testing/`)

export class RunTestsCommand extends Command {
  public static paths = [
    ['synthetics', 'run-tests'],
    ['synthetics', 'build-and-test'],
  ]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Run Synthetic tests with Datadog.',
    details: `
      This command will run Synthetic tests with Datadog, wait for the results and report a summary.\n
      https://docs.datadoghq.com/continuous_testing/cicd_integrations
    `,
    examples: [
      [
        'Explicitly specify multiple tests to run',
        'datadog-ci synthetics run-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      ['Discover tests with a search query', "datadog-ci synthetics run-tests --search 'tag:e2e-tests'"],
      [
        'Override the default glob pattern to group the tests in suites',
        'datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json',
      ],
      [
        'Override existing or inject new local and global variables in tests',
        'datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json --override variables.NAME=VALUE',
      ],
    ],
  })

  // JUnit options
  public jUnitReport = Option.String('-j,--jUnitReport', {
    description: 'The filename for a JUnit report if you want to generate one.',
  })
  public runName = Option.String('-n,--runName', {
    description: 'A name for this run, which will be included in the JUnit report.',
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

  public batchTimeout = Option.String('--batchTimeout', {
    description:
      'The duration in milliseconds after which the CI batch fails as timed out. This does not affect the outcome of a test run that already started.',
    validator: validation.isInteger(),
  })
  public failOnCriticalErrors = Option.Boolean('--failOnCriticalErrors', {
    description:
      'Fail the CI job if a critical error that is typically transient occurs, such as rate limits, authentication failures, or Datadog infrastructure issues.',
  })
  public failOnMissingTests = Option.Boolean('--failOnMissingTests', {
    description: `Fail the CI job if the list of tests to run is empty or if some explicitly listed tests are missing.`,
  })
  public failOnTimeout = Option.Boolean('--failOnTimeout', {
    description: 'A boolean flag that fails the CI job if at least one test exceeds the default test timeout.',
  })
  public files = Option.Array('-f,--files', {
    description: `Glob patterns to detect Synthetic ${$1`test configuration files`}}.`,
  })
  public mobileApplicationVersion = Option.String('--mobileApplicationVersion', {
    description: `Override the mobile application version for ${$6`Synthetic mobile application tests`}. The version must be uploaded and available within Datadog.`,
  })
  public mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath', {
    description: `Override the mobile application version for ${$6`Synthetic mobile application tests`} with a local or recently built application.`,
  })
  public overrides = Option.Array('--override', {
    description: 'Override specific test properties.',
  })
  public publicIds = Option.Array('-p,--public-id', {
    description: `Public IDs of Synthetic tests to run. If no value is provided, tests are discovered in Synthetic ${$1`test configuration files`}.`,
  })
  public selectiveRerun = Option.Boolean('--selectiveRerun', {
    description: `Whether to only rerun failed tests. If a test has already passed for a given commit, it will not be rerun in subsequent CI batches. By default, your ${$2`organization's default setting`} is used. Set it to \`false\` to force full runs when your configuration enables it by default.`,
  })
  public subdomain = Option.String('--subdomain', {
    description:
      'The custom subdomain to access your Datadog organization. If your URL is `myorg.datadoghq.com`, the custom subdomain is `myorg`.',
  })
  public testSearchQuery = Option.String('-s,--search', {
    description: `Use a ${$3`search query`} to select which Synthetic tests to run. Use the ${$4`Synthetic Tests list page's search bar`} to craft your query, then copy and paste it.`,
  })
  public tunnel = Option.Boolean('-t,--tunnel', {
    description: `Use the ${$5`Continuous Testing tunnel`} to launch tests against internal environments.`,
  })

  public buildCommand = Option.String('--buildCommand', {
    description: 'The build command to generate the assets to run the tests against.',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
