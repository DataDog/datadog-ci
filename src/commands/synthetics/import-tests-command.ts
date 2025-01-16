import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {LogLevel, Logger} from '../../helpers/logger'
import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'

import {importTests} from './import-tests-lib'
import {ImportTestsCommandConfig, MainReporter, Reporter} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {getReporter} from './utils/public'

export const DEFAULT_IMPORT_TESTS_COMMAND_CONFIG: ImportTestsCommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  files: [],
  proxy: {protocol: 'http'},
  publicIds: [],
  // subdomain: '',
  testSearchQuery: '',
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)
const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)

export class ImportTestsCommand extends Command {
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
      ['Override the default glob pattern', 'datadog-ci synthetics import-tests -f ./component-1/**/*.synthetics.json'],
    ],
  })

  private apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  private appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  private configPath = Option.String('--config', {description: `Pass a path to a ${$1('global configuration file')}.`})
  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test ${$2('configuration files')}}.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify a test to import.'})
  private testSearchQuery = Option.String('-s,--search', {
    description: 'Pass a query to select which Synthetic tests to run.',
  })

  private reporter!: MainReporter
  private config: ImportTestsCommandConfig = JSON.parse(JSON.stringify(DEFAULT_IMPORT_TESTS_COMMAND_CONFIG)) // Deep copy to avoid mutation

  private logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    try {
      await this.resolveConfig()
    } catch (error) {
      this.logger.error(`Error: invalid config`)

      return 1
    }

    try {
      await importTests(this.reporter, this.config)
    } catch (error) {
      // if (error instanceof CiError || error instanceof EndpointError || error instanceof CriticalError) {
      //   this.logger.error(`Error: ${error.message}`)
      // }

      return 1
    }
  }

  private async resolveConfig() {
    // Defaults < file < ENV < CLI
    try {
      // Override Config Path with ENV variables
      const overrideConfigPath = this.configPath ?? process.env.DATADOG_SYNTHETICS_CONFIG_PATH ?? 'datadog-ci.json'
      this.config = await resolveConfigFromFile(this.config, {
        configPath: overrideConfigPath,
        defaultConfigPaths: [this.config.configPath],
      })
    } catch (error) {
      if (this.configPath) {
        throw error
      }
    }

    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: process.env.DATADOG_SITE,
        files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
        publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
        testSearchQuery: process.env.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
      })
    )

    // Override with CLI parameters
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: this.apiKey,
        appKey: this.appKey,
        configPath: this.configPath,
        datadogSite: this.datadogSite,
        files: this.files,
        publicIds: this.publicIds,
        testSearchQuery: this.testSearchQuery,
      })
    )
  }
}
