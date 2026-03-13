/* eslint-disable @typescript-eslint/member-ordering */
import {SyntheticsRunLocalCommand} from '@datadog/datadog-ci-base/commands/synthetics/run-local'
import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getDatadogSiteFromEnv} from '@datadog/datadog-ci-base/helpers/api'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {resolveConfigFromFile, recursivelyRemoveUndefinedValues, removeUndefinedValues} from '@datadog/datadog-ci-base/helpers/utils'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import deepExtend from 'deep-extend'

import {CiError} from '../errors'
import {MainReporter, RunLocalCommandConfig} from '../interfaces'
import {DefaultReporter} from '../reporters/default'
import {executeRunLocal, getDefaultRunLocalConfig} from '../run-local-lib'
import {RecursivePartial} from '../utils/internal'
import {getReporter} from '../utils/public'

export class PluginCommand extends SyntheticsRunLocalCommand {
  protected config: RunLocalCommandConfig = getDefaultRunLocalConfig()
  protected fipsConfig = {
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  protected async resolveConfig(): Promise<void> {
    // Defaults < config file < ENV < CLI

    // Override with config file
    try {
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
    this.config = deepExtend(
      this.config,
      recursivelyRemoveUndefinedValues(this.resolveConfigFromEnv())
    )

    // Override with CLI parameters
    this.config = deepExtend(
      this.config,
      recursivelyRemoveUndefinedValues(this.resolveConfigFromCli())
    )
  }

  protected resolveConfigFromEnv(): RecursivePartial<RunLocalCommandConfig> {
    return {
      apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
      appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
      configPath: process.env.DATADOG_SYNTHETICS_CONFIG_PATH,
      datadogSite: getDatadogSiteFromEnv(),
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<RunLocalCommandConfig> {
    return removeUndefinedValues({
      apiKey: this.apiKey,
      appKey: this.appKey,
      configPath: this.configPath,
      datadogSite: this.datadogSite,
      ignoreTlsErrors: this.ignoreTlsErrors || undefined,
      overrideDomain: this.overrideDomain,
      testId: this.testId,
    })
  }

  protected validateConfig(): void {
    if (!this.config.testId) {
      throw new CiError('INVALID_CONFIG', 'A test ID must be provided via --test-id.')
    }

    if (!isValidDatadogSite(this.config.datadogSite)) {
      throw new CiError(
        'INVALID_CONFIG',
        `The \`datadogSite\` config property (${JSON.stringify(this.config.datadogSite)}) must match one of the sites supported by Datadog.`
      )
    }
  }

  public async execute(): Promise<number | void> {
    enableFips(this.fips || this.fipsConfig.fips, this.fipsIgnoreError || this.fipsConfig.fipsIgnoreError)

    try {
      await this.resolveConfig()
      this.validateConfig()
    } catch (error) {
      if (error instanceof CiError) {
        this.context.stderr.write(`Error: ${error.message}\n`)
      }

      return 1
    }

    const reporter: MainReporter = getReporter([new DefaultReporter(this)])

    return executeRunLocal(reporter, this.config)
  }
}
