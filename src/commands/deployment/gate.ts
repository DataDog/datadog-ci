import {isAxiosError} from 'axios'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import * as t from 'typanion'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '../../constants'
import {toBoolean} from '../../helpers/env'
import {enableFips} from '../../helpers/fips'
import {ICONS} from '../../helpers/formatting'
import {Logger, LogLevel} from '../../helpers/logger'
import {getApiHostForSite} from '../../helpers/utils'

import {apiConstructor} from './api'
import {APIHelper, GateEvaluationRequest} from './interfaces'

type CommandResult = 'PASS' | 'FAIL'

/**
 * This command allows to evaluate a deployment gate in Datadog.
 * It handles the entire process of requesting a gate evaluation and polling for results
 * The command will exit with status 0 when the gate passes and status 1 otherwise.
 */
export class DeploymentGateCommand extends Command {
  public static paths = [['deployment', 'gate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Evaluate deployment gates in Datadog.',
    details: `
      This command allows to evaluate a deployment gate in Datadog.
      The command will exit with status 0 when the gate passes and status 1 otherwise.
    `,
    examples: [
      [
        'Evaluate a deployment gate for payments-backend service in prod environment',
        'datadog-ci deployment gate --service payments-backend --env prod',
      ],
      [
        'Evaluate a deployment gate with custom timeout',
        'datadog-ci deployment gate --service payments-backend --env prod --timeout 7200',
      ],
      [
        'Evaluate a deployment gate and fail if an error occurs',
        'datadog-ci deployment gate --service payments-backend --env prod --fail-on-error',
      ],
      [
        'Evaluate a deployment gate with version and APM primary tag',
        'datadog-ci deployment gate --service payments-backend --env prod --version 1.2.3 --apm-primary-tag region:us-central-1',
      ],
    ],
  })

  // Required parameters
  private service = Option.String('--service', {
    description: 'The service name (e.g. payments-backend)',
    validator: t.isString(),
  })
  private env = Option.String('--env', {
    description: 'The environment name (e.g. prod, staging)',
    validator: t.isString(),
  })

  // Optional parameters
  private identifier = Option.String('--identifier', {
    description: 'The deployment identifier (defaults to "default")',
  })
  private version = Option.String('--version', {
    description: 'The deployment version (required for gates with faulty deployment detection rules)',
  })
  private apmPrimaryTag = Option.String('--apm-primary-tag', {
    description: 'The APM primary tag (only for gates with faulty deployment detection rules)',
  })
  private timeout = Option.String('--timeout', '10800', {
    description: 'Maximum amount of seconds to wait for the script execution in seconds (default: 10800 = 3 hours)',
    validator: t.isString(),
  })
  private failOnError = Option.Boolean('--fail-on-error', false, {
    description:
      'When true, the script will consider the gate as failed when timeout is reached or unexpected errors occur calling the Datadog APIs',
  })

  // FIPS options
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)
  private pollingInterval = 15000
  private startTime: number = Date.now()

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.service) {
      this.logger.error(chalk.red(`${ICONS.FAILED} Missing required parameter: ${chalk.bold('--service')}`))

      return 1
    }

    if (!this.env) {
      this.logger.error(chalk.red(`${ICONS.FAILED} Missing required parameter: ${chalk.bold('--env')}`))

      return 1
    }

    const timeoutSeconds = parseInt(this.timeout, 10)
    if (isNaN(timeoutSeconds) || timeoutSeconds <= 0) {
      this.logger.error(
        chalk.red(`${ICONS.FAILED} Invalid ${chalk.bold('--timeout')} value. Must be a positive integer.`)
      )

      return 1
    }

    if (!this.config.apiKey) {
      this.logger.error(
        `${ICONS.FAILED} Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold(
          'DD_API_KEY'
        )} are in your environment.`
      )

      return 1
    }

    if (!this.config.appKey) {
      this.logger.error(
        `${ICONS.FAILED} Neither ${chalk.red.bold('DATADOG_APP_KEY')} nor ${chalk.red.bold(
          'DD_APP_KEY'
        )} are in your environment.`
      )

      return 1
    }

    this.logger.info('Starting deployment gate evaluation with parameters:')
    this.logger.info(`\tService: ${this.service}`)
    this.logger.info(`\tEnvironment: ${this.env}`)
    if (this.identifier) {
      this.logger.info(`\tIdentifier: ${this.identifier}`)
    }
    if (this.version) {
      this.logger.info(`\tVersion: ${this.version}`)
    }
    if (this.apmPrimaryTag) {
      this.logger.info(`\tAPM Primary Tag: ${this.apmPrimaryTag}`)
    }
    this.logger.info(`\tTimeout: ${timeoutSeconds} seconds`)
    this.logger.info(`\tFail on error: ${this.failOnError ? 'true' : 'false'}\n`)

    let result: CommandResult

    try {
      const api = this.getApiHelper(this.config.apiKey, this.config.appKey)
      const evaluationRequest = this.buildEvaluationRequest()

      const evaluationId = await this.requestGateEvaluation(api, evaluationRequest)

      result = await this.pollForEvaluationResults(api, evaluationId, timeoutSeconds)
    } catch (error) {
      this.logger.error(`Deployment gate evaluation failed: ${error instanceof Error ? error.message : String(error)}`)

      if (isAxiosError(error)) {
        if (error.response?.status && error.response.status >= 400 && error.response.status < 500) {
          this.logger.error(`${ICONS.FAILED} Request failed with client error, exiting with status 1`)

          return 1
        }
      }

      result = this.getResultForDatadogError()
    }

    return result === 'PASS' ? 0 : 1
  }

  private getApiHelper(apiKey: string, appKey: string): APIHelper {
    const site = process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
    const baseAPIURL = `https://${getApiHostForSite(site)}`

    return apiConstructor(baseAPIURL, apiKey, appKey)
  }

  private buildEvaluationRequest(): GateEvaluationRequest {
    const request: GateEvaluationRequest = {
      service: this.service || '',
      env: this.env || '',
    }

    if (this.identifier) {
      request.identifier = this.identifier
    }

    if (this.version) {
      request.version = this.version
    }

    if (this.apmPrimaryTag) {
      request.apm_primary_tag = this.apmPrimaryTag
    }

    return request
  }

  private async requestGateEvaluation(api: APIHelper, request: GateEvaluationRequest): Promise<string> {
    this.logger.info('Requesting gate evaluation...')

    try {
      const response = await api.requestGateEvaluation(request)
      const evaluationId = response.data.data.attributes.evaluation_id
      this.logger.info(chalk.green(`Gate evaluation started successfully. Evaluation ID: ${evaluationId}\n`))

      return evaluationId
    } catch (error) {
      if (isAxiosError(error) && error.response?.status) {
        this.logger.error(`Request failed with client error: ${error.response.status} ${error.response.statusText}`)
      } else {
        this.logger.error(
          `Could not start gate evaluation with unknown error: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }

      throw error
    }
  }

  private async pollForEvaluationResults(
    api: APIHelper,
    evaluationId: string,
    timeoutSeconds: number
  ): Promise<CommandResult> {
    this.logger.info('Waiting for gate evaluation results...')

    const maxWaitTime = timeoutSeconds * 1000
    let timePassed = Date.now() - this.startTime
    let result: CommandResult | undefined

    while (timePassed < maxWaitTime) {
      const remainingTime = maxWaitTime - timePassed
      const waitTime = Math.min(this.pollingInterval, remainingTime)
      const waitTimeInSeconds = Math.floor(waitTime / 1000)

      result = await this.getEvaluationResult(api, evaluationId)
      if (result) {
        return result
      }

      this.logger.info(`\tRetrying in ${waitTimeInSeconds}s...`)
      await new Promise((resolve) => setTimeout(resolve, waitTime))

      timePassed = Date.now() - this.startTime
    }

    // The block above may not have run the last time, so we need to check again
    result = await this.getEvaluationResult(api, evaluationId)
    if (result) {
      return result
    }

    this.logger.warn(
      `${ICONS.WARNING} Timeout reached (${timeoutSeconds} seconds). Gate evaluation did not complete in time.`
    )

    return this.getResultForDatadogError()
  }

  private async getEvaluationResult(api: APIHelper, evaluationId: string): Promise<CommandResult | undefined> {
    try {
      const response = await api.getGateEvaluationResult(evaluationId)
      const status = response.data.data.attributes.gate_status

      switch (status) {
        case 'pass':
          this.logger.info(chalk.green(`\t${ICONS.SUCCESS} Gate evaluation passed`))

          return 'PASS'
        case 'fail':
          this.logger.info(chalk.red(`\t${ICONS.FAILED} Gate evaluation failed`))

          return 'FAIL'
        case 'in_progress':
          const rules = response.data.data.attributes.rules
          const totalRules = rules.length
          const completedRules = rules.filter((rule) => rule.status !== 'in_progress').length

          this.logger.info(`\tGate evaluation in progress (${completedRules}/${totalRules} rules completed)`)
          break

        default:
          this.logger.warn(`Unknown gate evaluation status: ${status}`)
      }
    } catch (error) {
      this.logger.error(
        `Error polling for gate evaluation results: ${error instanceof Error ? error.message : String(error)}`
      )

      return this.getResultForDatadogError()
    }
  }

  private getResultForDatadogError(): CommandResult {
    if (this.failOnError) {
      this.logger.warn('Unexpected error happened, exiting with status 1 because --fail-on-error is enabled')

      return 'FAIL'
    }

    this.logger.warn('Unexpected error happened, exiting with status 0')

    return 'PASS'
  }
}
