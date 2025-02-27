import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {Logger, LogLevel} from '../../helpers/logger'
import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'

import {deployTests} from './deploy-tests-lib'
import {DeployTestsCommandConfig, DatadogCIConfig, MainReporter, Reporter} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {getReporter} from './utils/public'

const DEFAULT_DATADOG_CI_COMMAND_CONFIG: DatadogCIConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  proxy: {protocol: 'http'},
}

export const getDefaultDatadogCiConfig = () => {
  // Deep copy to avoid mutation
  return JSON.parse(JSON.stringify(DEFAULT_DATADOG_CI_COMMAND_CONFIG)) as DatadogCIConfig
}

export const DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG: DeployTestsCommandConfig = {
  ...getDefaultDatadogCiConfig(),
  files: [],
  publicIds: [],
  subdomain: 'app',
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)
const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)

export abstract class BaseCommand extends Command {
  protected config: DatadogCIConfig = this.getDefaultConfig()
  protected reporter!: MainReporter

  protected configPath = Option.String('--config', {
    description: `Pass a path to a ${$1('global configuration file')}.`,
  })
  protected apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  protected appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  protected datadogSite = Option.String('--datadogSite', {
    description: 'The Datadog instance to which request is sent.',
  })

  protected fips = Option.Boolean('--fips', false)
  protected fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected logger: Logger = new Logger((s: string) => {
    this.context.stdout.write(s)
  }, LogLevel.INFO)

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    await this.resolveConfig()

    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)
  }

  // These methods should be overloaded by the child class, and called as super.<method> in the child class, to add more config.
  protected getDefaultConfig(): DatadogCIConfig {
    return getDefaultDatadogCiConfig()
  }

  protected resolveConfigFromEnv(): Partial<DatadogCIConfig> {
    return {
      apiKey: process.env.DATADOG_API_KEY,
      appKey: process.env.DATADOG_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE,
    }
  }

  protected resolveConfigFromCli(): Partial<DatadogCIConfig> {
    return {
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
    }
  }

  protected async resolveConfig() {
    // Defaults < file < ENV < CLI

    // Override with config file variables (e.g. datadog-ci.json)
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

    // Override with ENV variables
    this.config = deepExtend(this.config, removeUndefinedValues(this.resolveConfigFromEnv()))

    // Override with CLI parameters
    this.config = deepExtend(this.config, removeUndefinedValues(this.resolveConfigFromCli()))
  }
}

export class DeployTestsCommand extends BaseCommand {
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

  protected subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })

  protected config: DeployTestsCommandConfig = this.getDefaultConfig()

  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test ${$2('configuration files')}}.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify a test to run.'})

  public async execute() {
    // populate the config
    await this.setup()

    try {
      await deployTests(this.reporter, this.config)
    } catch (error) {
      this.logger.error(`Error: ${error.message}`)

      return 1
    }

    return 0
  }

  protected getDefaultConfig(): DeployTestsCommandConfig {
    return {
      ...super.getDefaultConfig(),
      ...DEFAULT_DEPLOY_TESTS_COMMAND_CONFIG,
    }
  }

  protected resolveConfigFromEnv(): Partial<DeployTestsCommandConfig> {
    return {
      ...super.resolveConfigFromEnv(),
      files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
      publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
      subdomain: process.env.DATADOG_SUBDOMAIN,
    }
  }

  protected resolveConfigFromCli(): Partial<DeployTestsCommandConfig> {
    return {
      ...super.resolveConfigFromCli(),
      files: this.files,
      publicIds: this.publicIds,
      subdomain: this.subdomain,
    }
  }
}
