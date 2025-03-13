import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'
import terminalLink from 'terminal-link'

import {toBoolean, toNumber, toStringMap} from '../../helpers/env'
import {removeUndefinedValues} from '../../helpers/utils'
import * as validation from '../../helpers/validation'
import {isValidDatadogSite} from '../../helpers/validation'

import {BaseCommand, getDefaultDatadogCiConfig, RecursivePartial} from './base-command'
import {CiError} from './errors'
import {Reporter, Result, RunTestsCommandConfig, Summary} from './interfaces'
import {JUnitReporter} from './reporters/junit'
import {executeTests} from './run-tests-lib'
import {toExecutionRule, validateAndParseOverrides} from './utils/internal'
import {getExitReason, getOrgSettings, renderResults, toExitCode, reportExitLogs} from './utils/public'

export const MAX_TESTS_TO_TRIGGER = 1000

export const DEFAULT_BATCH_TIMEOUT = 30 * 60 * 1000

export const DEFAULT_TEST_CONFIG_FILES_GLOB = '{,!(node_modules)/**/}*.synthetics.json'

export const DEFAULT_COMMAND_CONFIG: RunTestsCommandConfig = {
  ...getDefaultDatadogCiConfig(),
  batchTimeout: DEFAULT_BATCH_TIMEOUT,
  defaultTestOverrides: {},
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: [],
  jUnitReport: '',
  publicIds: [],
  subdomain: 'app',
  testSearchQuery: '',
  tunnel: false,
}

const configurationLink = 'https://docs.datadoghq.com/continuous_testing/cicd_integrations/configuration'

const $2 = (text: string) => terminalLink(text, `${configurationLink}#test-files`)
const $3 = (text: string) => terminalLink(text, `${configurationLink}#use-the-testing-tunnel`)

export class RunTestsCommand extends BaseCommand {
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
        'datadog-ci synthetics run-tests -f ./component-1/**/*.synthetics.json --override variables.NAME=VALUE',
      ],
    ],
  })

  // JUnit options
  public jUnitReport = Option.String('-j,--jUnitReport', {description: 'Pass a path to a JUnit report file.'})
  public runName = Option.String('-n,--runName', {
    description: 'A name for this run, which will be included in the JUnit report file.',
  })

  protected config: RunTestsCommandConfig = this.getDefaultConfig()

  private batchTimeout = Option.String('--batchTimeout', {
    description:
      'The duration (in milliseconds) after which `datadog-ci` stops waiting for test results. The default is 30 minutes. At the CI level, test results completed after this duration are considered failed.',
    validator: validation.isInteger(),
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
  private overrides = Option.Array('--override', {
    description: 'Override specific test properties.',
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

  public async execute() {
    await this.setup()

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

  protected getDefaultConfig(): RunTestsCommandConfig {
    return {
      ...super.getDefaultConfig(),
      ...DEFAULT_COMMAND_CONFIG,
    }
  }

  protected resolveConfigFromEnv(): RecursivePartial<RunTestsCommandConfig> {
    const envOverrideBasicAuth = deepExtend(
      this.config.defaultTestOverrides?.basicAuth ?? {},
      removeUndefinedValues({
        password: process.env.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_PASSWORD,
        username: process.env.DATADOG_SYNTHETICS_OVERRIDE_BASIC_AUTH_USERNAME,
      })
    )
    const envOverrideCookies = removeUndefinedValues({
      append: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_COOKIES_APPEND),
      value: process.env.DATADOG_SYNTHETICS_OVERRIDE_COOKIES,
    })
    const envOverrideSetCookies = removeUndefinedValues({
      append: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES_APPEND),
      value: process.env.DATADOG_SYNTHETICS_OVERRIDE_SET_COOKIES,
    })
    const envOverrideRetryConfig = deepExtend(
      this.config.defaultTestOverrides?.retry ?? {},
      removeUndefinedValues({
        count: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_RETRY_COUNT),
        interval: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_RETRY_INTERVAL),
      })
    )

    return {
      ...super.resolveConfigFromEnv(),
      batchTimeout: toNumber(process.env.DATADOG_SYNTHETICS_BATCH_TIMEOUT),
      defaultTestOverrides: {
        allowInsecureCertificates: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_ALLOW_INSECURE_CERTIFICATES),
        basicAuth: Object.keys(envOverrideBasicAuth).length > 0 ? envOverrideBasicAuth : undefined,
        body: process.env.DATADOG_SYNTHETICS_OVERRIDE_BODY,
        bodyType: process.env.DATADOG_SYNTHETICS_OVERRIDE_BODY_TYPE,
        cookies: Object.keys(envOverrideCookies).length > 0 ? envOverrideCookies : undefined,
        setCookies: Object.keys(envOverrideSetCookies).length > 0 ? envOverrideSetCookies : undefined,
        defaultStepTimeout: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_DEFAULT_STEP_TIMEOUT),
        deviceIds: process.env.DATADOG_SYNTHETICS_OVERRIDE_DEVICE_IDS?.split(';'),
        executionRule: toExecutionRule(process.env.DATADOG_SYNTHETICS_OVERRIDE_EXECUTION_RULE),
        followRedirects: toBoolean(process.env.DATADOG_SYNTHETICS_OVERRIDE_FOLLOW_REDIRECTS),
        headers: toStringMap(process.env.DATADOG_SYNTHETICS_OVERRIDE_HEADERS),
        locations: process.env.DATADOG_SYNTHETICS_OVERRIDE_LOCATIONS?.split(';'),
        mobileApplicationVersion: process.env.DATADOG_SYNTHETICS_OVERRIDE_MOBILE_APPLICATION_VERSION,
        resourceUrlSubstitutionRegexes: process.env.DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES?.split(
          ';'
        ),
        retry: Object.keys(envOverrideRetryConfig).length > 0 ? envOverrideRetryConfig : undefined,
        startUrl: process.env.DATADOG_SYNTHETICS_OVERRIDE_START_URL,
        startUrlSubstitutionRegex: process.env.DATADOG_SYNTHETICS_OVERRIDE_START_URL_SUBSTITUTION_REGEX,
        testTimeout: toNumber(process.env.DATADOG_SYNTHETICS_OVERRIDE_TEST_TIMEOUT),
        variables: toStringMap(process.env.DATADOG_SYNTHETICS_OVERRIDE_VARIABLES),
      },
      failOnCriticalErrors: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_CRITICAL_ERRORS),
      failOnMissingTests: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_MISSING_TESTS),
      failOnTimeout: toBoolean(process.env.DATADOG_SYNTHETICS_FAIL_ON_TIMEOUT),
      files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
      jUnitReport: process.env.DATADOG_SYNTHETICS_JUNIT_REPORT,
      publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
      selectiveRerun: toBoolean(process.env.DATADOG_SYNTHETICS_SELECTIVE_RERUN),
      subdomain: process.env.DATADOG_SUBDOMAIN,
      testSearchQuery: process.env.DATADOG_SYNTHETICS_TEST_SEARCH_QUERY,
      tunnel: toBoolean(process.env.DATADOG_SYNTHETICS_TUNNEL),
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<RunTestsCommandConfig> {
    let validatedOverrides
    try {
      validatedOverrides = validateAndParseOverrides(this.overrides)
    } catch (error) {
      throw new CiError('INVALID_CONFIG', error.message)
    }

    const cliOverrideBasicAuth = deepExtend(
      this.config.defaultTestOverrides?.basicAuth ?? {},
      removeUndefinedValues({
        password: validatedOverrides.basicAuth?.password,
        username: validatedOverrides.basicAuth?.username,
      })
    )
    const cliOverrideCookies = removeUndefinedValues({
      append: validatedOverrides.cookies?.append,
      value: validatedOverrides.cookies?.value,
    })
    const cliOverrideSetCookies = removeUndefinedValues({
      append: validatedOverrides.setCookies?.append,
      value: validatedOverrides.setCookies?.value,
    })
    const cliOverrideRetryConfig = deepExtend(
      this.config.defaultTestOverrides?.retry ?? {},
      removeUndefinedValues({
        count: validatedOverrides.retry?.count,
        interval: validatedOverrides.retry?.interval,
      })
    )

    return {
      ...super.resolveConfigFromCli(),
      batchTimeout: this.batchTimeout,
      defaultTestOverrides: {
        allowInsecureCertificates: validatedOverrides.allowInsecureCertificates,
        basicAuth: Object.keys(cliOverrideBasicAuth).length > 0 ? cliOverrideBasicAuth : undefined,
        body: validatedOverrides.body,
        bodyType: validatedOverrides.bodyType,
        cookies: Object.keys(cliOverrideCookies).length > 0 ? cliOverrideCookies : undefined,
        setCookies: Object.keys(cliOverrideSetCookies).length > 0 ? cliOverrideSetCookies : undefined,
        defaultStepTimeout: validatedOverrides.defaultStepTimeout,
        deviceIds: validatedOverrides.deviceIds,
        executionRule: validatedOverrides.executionRule,
        followRedirects: validatedOverrides.followRedirects,
        headers: validatedOverrides.headers,
        locations: validatedOverrides.locations,
        mobileApplicationVersion: this.mobileApplicationVersion,
        mobileApplicationVersionFilePath: this.mobileApplicationVersionFilePath,
        resourceUrlSubstitutionRegexes: validatedOverrides.resourceUrlSubstitutionRegexes,
        retry: Object.keys(cliOverrideRetryConfig).length > 0 ? cliOverrideRetryConfig : undefined,
        startUrl: validatedOverrides.startUrl,
        startUrlSubstitutionRegex: validatedOverrides.startUrlSubstitutionRegex,
        testTimeout: validatedOverrides.testTimeout,
        variables: validatedOverrides.variables,
      },
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
    }
  }

  protected normalizeConfig() {
    // Convert cookies to object
    if (typeof this.config.defaultTestOverrides?.cookies === 'string') {
      this.config.defaultTestOverrides.cookies = {value: this.config.defaultTestOverrides.cookies}
    }

    // Convert setCookies to object
    if (typeof this.config.defaultTestOverrides?.setCookies === 'string') {
      this.config.defaultTestOverrides.setCookies = {value: this.config.defaultTestOverrides.setCookies}
    }
  }

  protected validateConfig() {
    if (!isValidDatadogSite(this.config.datadogSite)) {
      throw new CiError(
        'INVALID_CONFIG',
        `The \`datadogSite\` config property (${JSON.stringify(
          this.config.datadogSite
        )}) must match one of the sites supported by Datadog.\nFor more information, see "Site parameter" in our documentation: https://docs.datadoghq.com/getting_started/site/#access-the-datadog-site`
      )
    }

    if (
      typeof this.config.defaultTestOverrides?.cookies === 'object' &&
      !this.config.defaultTestOverrides.cookies.value
    ) {
      throw new CiError('INVALID_CONFIG', 'Cookies value cannot be empty.')
    }

    if (
      typeof this.config.defaultTestOverrides?.setCookies === 'object' &&
      !this.config.defaultTestOverrides.setCookies.value
    ) {
      throw new CiError('INVALID_CONFIG', 'SetCookies value cannot be empty.')
    }
  }

  protected getReporters(): Reporter[] {
    if (this.config.jUnitReport) {
      return [
        new JUnitReporter({
          context: this.context,
          jUnitReport: this.config.jUnitReport,
          runName: this.runName,
        }),
      ]
    }

    return []
  }
}
