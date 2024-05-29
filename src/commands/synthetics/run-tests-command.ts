import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {removeUndefinedValues, resolveConfigFromFile} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {isValidDatadogSite} from '../../helpers/validation'

import {replaceGlobalWithDefaultTestOverrides} from './compatibility'
import {CiError} from './errors'
import {MainReporter, Reporter, Result, RunTestsCommandConfig, Summary} from './interfaces'
import {DefaultReporter} from './reporters/default'
import {JUnitReporter} from './reporters/junit'
import {executeTests} from './run-tests-lib'
import {toBoolean, toNumber, toExecutionRule} from './utils/internal'
import {
  getExitReason,
  getOrgSettings,
  getReporter,
  parseVariablesFromCli,
  renderResults,
  reportCiError,
  toExitCode,
  reportExitLogs,
} from './utils/public'

export const MAX_TESTS_TO_TRIGGER = 100

export const DEFAULT_POLLING_TIMEOUT = 30 * 60 * 1000

export const DEFAULT_COMMAND_CONFIG: RunTestsCommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
  global: {},
  defaultTestOverrides: {},
  jUnitReport: '',
  locations: [],
  pollingTimeout: DEFAULT_POLLING_TIMEOUT,
  proxy: {protocol: 'http'},
  publicIds: [],
  selectiveRerun: false,
  subdomain: 'app',
  testSearchQuery: '',
  tunnel: false,
  variableStrings: [],
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $1 = (text: string) => terminalLink(text, `${configurationLink}#global-configuration-file-options`)
const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)
const $3 = (text: string) => terminalLink(text, `${configurationLink}#use-the-testing-tunnel`)

export class RunTestsCommand extends Command {
  public static paths = [['synthetics', 'run-tests']]

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
        'Pass variables as arguments',
        'datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json --variable PASSWORD=$PASSWORD',
      ],
    ],
  })

  public configPath = Option.String('--config', {description: `Pass a path to a ${$1('global configuration file')}.`})
  public jUnitReport = Option.String('-j,--jUnitReport', {description: 'Pass a path to a JUnit report file.'})
  public runName = Option.String('-n,--runName', {
    description: 'A name for this run, which will be included in the JUnit report file.',
  })

  private apiKey = Option.String('--apiKey', {description: 'The API key used to query the Datadog API.'})
  private appKey = Option.String('--appKey', {description: 'The application key used to query the Datadog API.'})
  private datadogSite = Option.String('--datadogSite', {description: 'The Datadog instance to which request is sent.'})
  private deviceIds = Option.Array('--deviceIds', {
    description: 'Override the mobile device(s) to run your mobile test.',
  })
  private failOnCriticalErrors = Option.Boolean('--failOnCriticalErrors', {
    description:
      'A boolean flag that fails the CI job if no tests were triggered, or results could not be fetched from Datadog.',
  })
  private failOnMissingTests = Option.Boolean('--failOnMissingTests', {
    description: `A boolean flag that fails the CI job if at least one specified test with a public ID (a \`--public-id\` CLI argument or listed in a ${$2(
      'test file'
    )} is missing in a run (for example, if it has been deleted programmatically or on the Datadog site).`,
  })
  private failOnTimeout = Option.Boolean('--failOnTimeout', {
    description: 'A boolean flag that fails the CI job if at least one test exceeds the default test timeout.',
  })
  private files = Option.Array('-f,--files', {
    description: `Glob pattern to detect Synthetic test ${$2('configuration files')}}.`,
  })
  private mobileApplicationVersion = Option.String('--mobileApplicationVersion', {
    description: 'Override the default mobile application version to test a different version within Datadog.',
  })
  private mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath', {
    description: 'Override the application version for all Synthetic mobile application tests.',
  })
  private pollingTimeout = Option.String('--pollingTimeout', {
    description:
      'The duration (in milliseconds) after which `datadog-ci` stops polling for test results. The default is 30 minutes. At the CI level, test results completed after this duration are considered failed.',
    validator: validation.isInteger(),
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Specify a test to run.'})
  private selectiveRerun = Option.Boolean('--selectiveRerun', {
    description:
      'A boolean flag to only run the tests which failed in the previous test batches. Use `--no-selectiveRerun` to force a full run if your configuration enables it by default.',
  })
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })
  private testSearchQuery = Option.String('-s,--search', {
    description: 'Pass a query to select which Synthetic tests to run.',
  })
  private tunnel = Option.Boolean('-t,--tunnel', {
    description: `Use the ${$3('Continuous Testing Tunnel')} to execute your test batch.`,
  })
  private variableStrings = Option.Array('-v,--variable', {description: 'Pass a variable override.'})

  private reporter!: MainReporter
  private config: RunTestsCommandConfig = JSON.parse(JSON.stringify(DEFAULT_COMMAND_CONFIG)) // Deep copy to avoid mutation

  public async execute() {
    try {
      await this.resolveConfig()
    } catch (error) {
      if (error instanceof CiError) {
        reportCiError(error, this.reporter)
      }

      return 1
    }

    const reporters: Reporter[] = [new DefaultReporter(this)]
    this.reporter = getReporter(reporters)

    if (this.config.jUnitReport) {
      reporters.push(
        new JUnitReporter({
          context: this.context,
          jUnitReport: this.config.jUnitReport,
          runName: this.runName,
        })
      )
    }

    const startTime = Date.now()
    if (this.config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
    }

    let results: Result[]
    let summary: Summary

    try {
      ;({results, summary} = await executeTests(this.reporter, this.config))
    } catch (error) {
      reportExitLogs(this.reporter, this.config, {error})

      return toExitCode(getExitReason(this.config, {error}))
    }

    const orgSettings = await getOrgSettings(this.reporter, this.config)

    renderResults({
      config: this.config,
      orgSettings,
      reporter: this.reporter,
      results,
      startTime,
      summary,
    })

    reportExitLogs(this.reporter, this.config, {results})

    return toExitCode(getExitReason(this.config, {results}))
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

    // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
    this.config = replaceGlobalWithDefaultTestOverrides(this.config, this.reporter)

    // Override with ENV variables
    this.config = deepExtend(
      this.config,
      removeUndefinedValues({
        apiKey: process.env.DATADOG_API_KEY,
        appKey: process.env.DATADOG_APP_KEY,
        configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH,
        datadogSite: process.env.DATADOG_SITE,
        failOnCriticalErrors: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS),
        failOnMissingTests: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS),
        failOnTimeout: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT),
        files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
        jUnitReport: process.env.DATADOG_SYNTHETICS_JUNIT_REPORT,
        locations: process.env.DATADOG_SYNTHETICS_LOCATIONS?.split(';'),
        publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
        selectiveRerun: toBoolean(process.env.DATADOG_SYNTHETICS_SELECTIVE_RERUN),
        subdomain: process.env.DATADOG_SUBDOMAIN,
        testSearchQuery: process.env.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
        tunnel: toBoolean(process.env.DATADOG_SYNTHETICS_TUNNEL),
      })
    )

    // Override with OVERRIDE ENV variables
    const retryConfig = removeUndefinedValues({
      count: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT),
      interval: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL),
    })
    this.config.defaultTestOverrides = deepExtend(
      this.config.defaultTestOverrides,
      removeUndefinedValues({
        deviceIds: process.env.DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS?.split(';'),
        mobileApplicationVersion: process.env.DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION,
        allowInsecureCertificates: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES),
        body: process.env.DATADOG_SYNTHETICS_OVERRIDE_BODY,
        bodyType: process.env.DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE,
        defaultStepTimeout: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT),
        executionRule: toExecutionRule(process.env.DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE),
        followRedirects: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS),
        resourceUrlSubstitutionRegexes: process.env.DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES?.split(
          ';'
        ),
        retry: Object.keys(retryConfig).length > 0 ? retryConfig : undefined,
        startUrl: process.env.DATADOG_SYNTHETICS_OVERRIDE_START_URL,
        startUrlSubstitutionRegex: process.env.DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX,
        testTimeout: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT),
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
        failOnCriticalErrors: this.failOnCriticalErrors,
        failOnMissingTests: this.failOnMissingTests,
        failOnTimeout: this.failOnTimeout,
        files: this.files,
        jUnitReport: this.jUnitReport,
        publicIds: this.publicIds,
        selectiveRerun: this.selectiveRerun,
        subdomain: this.subdomain,
        testSearchQuery: this.testSearchQuery,
        tunnel: this.tunnel,
      })
    )

    // Override with Global CLI parameters
    this.config.defaultTestOverrides = deepExtend(
      this.config.defaultTestOverrides,
      removeUndefinedValues({
        deviceIds: this.deviceIds,
        mobileApplicationVersion: this.mobileApplicationVersion,
        mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
        variables: parseVariablesFromCli(this.variableStrings, (log) => this.reporter.log(log)),
        pollingTimeout:
          this.pollingTimeout ?? this.config.defaultTestOverrides?.pollingTimeout ?? this.config.pollingTimeout,
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
