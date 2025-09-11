/* eslint-disable @typescript-eslint/member-ordering */
import {RunTestsCommand} from '@datadog/datadog-ci-base/commands/synthetics/run-tests-command'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {toBoolean, toNumber, toStringMap} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {
  recursivelyRemoveUndefinedValues,
  removeUndefinedValues,
  resolveConfigFromFile,
} from '@datadog/datadog-ci-base/helpers/utils'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import deepExtend from 'deep-extend'

import {buildAssets} from '../build-and-test'
import {CiError} from '../errors'
import {MainReporter, Reporter, Result, RunTestsCommandConfig, Summary} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {JUnitReporter} from '../reporters/junit'
import {executeTests, getDefaultConfig} from '../run-tests-lib'
import {RecursivePartial} from '../utils/internal'
import {toExecutionRule, validateAndParseOverrides} from '../utils/internal'
import {getExitReason, getOrgSettings, renderResults, toExitCode, reportExitLogs, getReporter} from '../utils/public'

export class PluginCommand extends RunTestsCommand {
  protected reporter!: MainReporter
  protected config: RunTestsCommandConfig = getDefaultConfig()
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected async setup() {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    // Bootstrap reporter
    this.reporter = getReporter([new DefaultReporter(this)])

    // Load config
    await this.resolveConfig()
    this.normalizeConfig()
    this.validateConfig()

    // Update reporter
    this.reporter = getReporter([new DefaultReporter(this), ...this.getReporters()])
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
        throw new CiError('INVALID_CONFIG', error.message)
      }
    }

    // Override with ENV variables
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromEnv()))

    // Override with CLI parameters
    this.config = deepExtend(this.config, recursivelyRemoveUndefinedValues(this.resolveConfigFromCli()))
  }

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

    let teardown = async () => {}

    const [_, command] = this.path ?? []
    if (command === 'build-and-test') {
      if (!this.config.buildCommand) {
        this.reporter.error('The `buildCommand` option is required for the `build-and-test` command.')

        return 1
      }

      const {builds, devServerUrl, stop} = await buildAssets(this.config.buildCommand, this.reporter)
      teardown = stop

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
      await teardown()
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
      // ...super.resolveConfigFromEnv(),
      // BASE COMMAND START
      apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
      appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH, // Only used for debugging
      datadogSite: process.env.DATADOG_SITE || process.env.DD_SITE,
      // BASE COMMAND END
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
        resourceUrlSubstitutionRegexes:
          process.env.DATADOG_SYNTHETICS_OVERRIDE_RESOURCE_URL_SUBSTITUTION_REGEXES?.split(';'),
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
      // ...super.resolveConfigFromCli(),
      // BASE COMMAND START
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
      // BASE COMMAND END
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
}
