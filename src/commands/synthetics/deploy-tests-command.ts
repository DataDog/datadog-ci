import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {getCommonAppBaseURL} from '../../helpers/app'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'
import {isValidDatadogSite} from '../../helpers/validation'

import {EndpointError, formatBackendErrors, getApiHelper} from './api'
import {CiError} from './errors'
import {LocalTestDefinition, MainReporter, Reporter, RunTestsCommandConfig} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'
import {getReporter, reportCiError} from './utils/public'

export const DEFAULT_COMMAND_CONFIG = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  files: [],
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)
const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)

export class DeployTestsCommand extends Command {
  public static paths = [['synthetics', 'deploy-tests']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Deploy Local Test Definitions as scheduled tests in Datadog.',
    details: `
      This command deploys Local Test Definitions as scheduled tests in Datadog, usually when a feature branch is merged.
    `,
    examples: [
      [
        'Explicitly specify multiple tests to run',
        'datadog-ci synthetics deploy-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      [
        'Override the default glob pattern',
        'datadog-ci synthetics deploy-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json',
      ],
    ],
  })

  public configPath = Option.String('--config', {description: `Pass a path to a ${$1('global configuration file')}.`})

  private apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  private appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test ${$2('configuration files')}}.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify a test to run.'})
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })

  private reporter!: MainReporter
  private config: RunTestsCommandConfig = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) // Deep copy to avoid mutation

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)
  private fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)

    try {
      await this.resolveConfig()
    } catch (error) {
      if (error instanceof CiError) {
        reportCiError(error, this.reporter)
      }

      return 1
    }

    const testConfigs = await getTestConfigs(this.config, this.reporter)

    const first = isLocalTriggerConfig(testConfigs[0]) ? testConfigs[0] : undefined
    if (!first) {
      throw new Error('No test configurations found')
    }

    const api = getApiHelper(this.config)

    const publicId = first.local_test_definition.public_id! // or passed publicId without id-less LTD

    const existingRemoteTest = await api.getTest(publicId)

    const remoteTest = {
      ...existingRemoteTest,
      ...first.local_test_definition,
      config: {
        ...existingRemoteTest.config,
        ...first.local_test_definition.config,
      },
      options: {
        ...existingRemoteTest.options,
        ...first.local_test_definition.options,
      },
    } as LocalTestDefinition

    /* eslint-disable @typescript-eslint/no-unsafe-member-access */
    delete (remoteTest as any).creator
    delete (remoteTest as any).monitor_id
    delete (remoteTest as any).created_at
    delete (remoteTest as any).modified_at
    delete (remoteTest as any).public_id
    /* eslint-enable @typescript-eslint/no-unsafe-member-access */

    // TODO: If public ID is passed, they are used for selection among the JSON files. If one public ID is not found, crash. If no public ID is passed, all JSON files are used.

    try {
      await api.editTest(publicId, remoteTest)

      const baseUrl = getCommonAppBaseURL(this.config.datadogSite, this.config.subdomain)
      const testLink = `${baseUrl}synthetics/details/${publicId}`

      // If we had a version property in the response, we could have a link of the form: https://dd.datad0g.com/synthetics/version/77k-qct-9he?versionUUID=<new-version-uuid>
      // Or we could use the `https://dd.datad0g.com/api/v2/synthetics/tests/77k-qct-9he/version_history` endpoint to get the version history info, and show some info about the diff - or at least know the latest version.

      this.reporter.log(`Test ${publicId} has been successfully edited: ${testLink}\n`)
    } catch (e) {
      const errorMessage = formatBackendErrors(e)
      throw new EndpointError(`[${publicId}] Failed to edit test: ${errorMessage}\n`, e.response?.status)
    }
  }

  private async resolveConfig() {
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
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
        datadogSite: process.env.DATADOG_SITE,
        files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
        publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
        subdomain: process.env.DATADOG_SUBDOMAIN,
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
        subdomain: this.subdomain,
      })
    )

    if (typeof this.config.files === 'string') {
      this.reporter.log('[DEPRECATED] "files" should be an array of string instead of a string.\n')
      this.config.files = [this.config.files]
    }

    if (!isValidDatadogSite(this.config.datadogSite)) {
      throw new CiError(
        'INVALID_CONFIG',
        `The \`datadogSite\` config property (${JSON.stringify(
          this.config.datadogSite
        )}) must match one of the sites supported by Datadog.\nFor more information, see "Site parameter" in our documentation: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site`
      )
    }
  }
}
