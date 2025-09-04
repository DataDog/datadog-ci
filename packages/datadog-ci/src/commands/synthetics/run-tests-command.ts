import {toBoolean, toNumber, toStringMap} from '@datadog/datadog-ci-base/helpers/env'
import {makeTerminalLink, removeUndefinedValues} from '@datadog/datadog-ci-base/helpers/utils'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import {Command, Option} from 'clipanion'
import deepExtend from 'deep-extend'

import {BaseCommand, RecursivePartial} from './base-command'
import {buildAssets} from './build-and-test'
import {CiError} from './errors'
import {Reporter, Result, RunTestsCommandConfig, Summary} from './interfaces'
import {JUnitReporter} from './reporters/junit'
import {executeTests, getDefaultConfig} from './run-tests-lib'
import {toExecutionRule, validateAndParseOverrides} from './utils/internal'
import {getExitReason, getOrgSettings, renderResults, toExitCode, reportExitLogs} from './utils/public'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'
const datadogAppBaseUrl = 'https://app.datadoghq.com'

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#test-files`)
const $2 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/settings/continuous-testing`)
const $3 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/explore/#search`)
const $4 = makeTerminalLink(`${datadogAppBaseUrl}/synthetics/tests`)
const $5 = makeTerminalLink(
  `${datadogDocsBaseUrl}/continuous_testing/environments/proxy_firewall_vpn#what-is-the-testing-tunnel`
)
const $6 = makeTerminalLink(`${datadogDocsBaseUrl}/synthetics/mobile_app_testing/`)

export class RunTestsCommand extends BaseCommand {
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

  protected config: RunTestsCommandConfig = getDefaultConfig()

  private batchTimeout = Option.String('--batchTimeout', {
    description:
      'The duration in milliseconds after which the CI batch fails as timed out. This does not affect the outcome of a test run that already started.',
    validator: validation.isInteger(),
  })
  private failOnCriticalErrors = Option.Boolean('--failOnCriticalErrors', {
    description:
      'Fail the CI job if a critical error that is typically transient occurs, such as rate limits, authentication failures, or Datadog infrastructure issues.',
  })
  private failOnMissingTests = Option.Boolean('--failOnMissingTests', {
    description: `Fail the CI job if the list of tests to run is empty or if some explicitly listed tests are missing.`,
  })
  private failOnTimeout = Option.Boolean('--failOnTimeout', {
    description: 'A boolean flag that fails the CI job if at least one test exceeds the default test timeout.',
  })
  private files = Option.Array('-f,--files', {
    description: `Glob patterns to detect Synthetic ${$1`test configuration files`}}.`,
  })
  private mobileApplicationVersion = Option.String('--mobileApplicationVersion', {
    description: `Override the mobile application version for ${$6`Synthetic mobile application tests`}. The version must be uploaded and available within Datadog.`,
  })
  private mobileApplicationVersionFilePath = Option.String('--mobileApp,--mobileApplicationVersionFilePath', {
    description: `Override the mobile application version for ${$6`Synthetic mobile application tests`} with a local or recently built application.`,
  })
  private overrides = Option.Array('--override', {
    description: 'Override specific test properties.',
  })
  private publicIds = Option.Array('-p,--public-id', {
    description: `Public IDs of Synthetic tests to run. If no value is provided, tests are discovered in Synthetic ${$1`test configuration files`}.`,
  })
  private selectiveRerun = Option.Boolean('--selectiveRerun', {
    description: `Whether to only rerun failed tests. If a test has already passed for a given commit, it will not be rerun in subsequent CI batches. By default, your ${$2`organization's default setting`} is used. Set it to \`false\` to force full runs when your configuration enables it by default.`,
  })
  private subdomain = Option.String('--subdomain', {
    description:
      'The custom subdomain to access your Datadog organization. If your URL is `myorg.datadoghq.com`, the custom subdomain is `myorg`.',
  })
  private testSearchQuery = Option.String('-s,--search', {
    description: `Use a ${$3`search query`} to select which Synthetic tests to run. Use the ${$4`Synthetic Tests list page's search bar`} to craft your query, then copy and paste it.`,
  })
  private tunnel = Option.Boolean('-t,--tunnel', {
    description: `Use the ${$5`Continuous Testing tunnel`} to launch tests against internal environments.`,
  })

  private buildCommand = Option.String('--buildCommand', {
    description: 'The build command to generate the assets to run the tests against.',
  })

  private tearDowns: (() => Promise<void>)[] = []

  public async execute() {
    try {
      await this.setup()
    } catch (error) {
      reportExitLogs(this.reporter, this.config, {error})

      return 1
    }

    const startTime = Date.now()
    if (this.config.tunnel) {
      this.reporter.log(
        'You are using tunnel option, the chosen location(s) will be overridden by a location in your account region.\n'
      )
    }

    let results: Result[]
    let summary: Summary

    const [_, command] = this.path ?? []
    if (command === 'build-and-test') {
      if (!this.config.buildCommand) {
        this.reporter.error('The `buildCommand` option is required for the `build-and-test` command.')

        return 1
      }

      const {builds, devServerUrl, stop} = await buildAssets(this.config.buildCommand, this.reporter)
      this.tearDowns.push(stop)

      const resourceUrlSubstitutionRegexes = builds.map(
        // All of the resources matching the publicPath prefix will be redirected to the dev server.
        (build) => `.*${build.publicPath}|${devServerUrl}/${build.publicPath}`
      )

      this.config = deepExtend(this.config, {
        tunnel: true,
        defaultTestOverrides: {
          resourceUrlSubstitutionRegexes,
        },
      })
    }

    try {
      ;({results, summary} = await executeTests(this.reporter, this.config))
    } catch (error) {
      reportExitLogs(this.reporter, this.config, {error})

      return toExitCode(getExitReason(this.config, {error}))
    } finally {
      await this.tearDown()
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

  protected resolveConfigFromEnv(): RecursivePartial<RunTestsCommandConfig> {
    // Override with OVERRIDE ENV variables
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
      buildCommand: process.env.DATADOG_SYNTHETICS_BUILD_COMMAND,
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
    // Override defaultTestOverrides with CLI parameters
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
      buildCommand: this.buildCommand,
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

  private tearDown = async () => {
    for (const tearDown of this.tearDowns) {
      await tearDown()
    }
  }
}
