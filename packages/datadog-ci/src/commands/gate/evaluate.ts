import type {APIHelper, EvaluationResponse, EvaluationResponsePayload, Payload, PayloadOptions} from './interfaces'
import type {AxiosResponse} from 'axios'

import {FIPS_ENV_VAR, FIPS_IGNORE_ERROR_ENV_VAR} from '@datadog/datadog-ci-base/constants'
import {getCISpanTags} from '@datadog/datadog-ci-base/helpers/ci'
import {toBoolean} from '@datadog/datadog-ci-base/helpers/env'
import {enableFips} from '@datadog/datadog-ci-base/helpers/fips'
import {getGitMetadata} from '@datadog/datadog-ci-base/helpers/git/format-git-span-data'
import {SpanTags} from '@datadog/datadog-ci-base/helpers/interfaces'
import {Logger, LogLevel} from '@datadog/datadog-ci-base/helpers/logger'
import {retryRequest} from '@datadog/datadog-ci-base/helpers/retry'
import {GIT_HEAD_SHA, GIT_PULL_REQUEST_BASE_BRANCH, parseTags} from '@datadog/datadog-ci-base/helpers/tags'
import {getUserGitSpanTags} from '@datadog/datadog-ci-base/helpers/user-provided-git'
import * as validation from '@datadog/datadog-ci-base/helpers/validation'
import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {v4 as uuidv4} from 'uuid'

import {apiConstructor} from './api'
import {
  renderEvaluationResponse,
  renderGateEvaluationInput,
  renderGateEvaluationError,
  renderEvaluationRetry,
  renderWaiting,
} from './renderer'
import {getBaseIntakeUrl, is4xxError, is5xxError, isTimeout, parseScope} from './utils'

export class GateEvaluateCommand extends Command {
  public static paths = [['gate', 'evaluate']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Evaluate Quality Gates rules in Datadog.',
    details: `
      This command will evaluate the matching quality gate rules in Datadog.\n
      See README for details.
    `,
    examples: [
      ['Evaluate matching quality gate rules in Datadog', 'datadog-ci gate evaluate'],
      [
        'Evaluate matching quality gate rules in Datadog, failing if no rules were found',
        'datadog-ci gate evaluate --fail-on-empty',
      ],
      [
        'Evaluate matching quality gate rules in Datadog, failing if Datadog is not available',
        'datadog-ci gate evaluate --fail-if-unavailable',
      ],
      [
        'Evaluate matching quality gate rules in Datadog and add extra scope',
        'datadog-ci gate evaluate --scope team:backend',
      ],
      [
        'Evaluate matching quality gate rules in Datadog and add extra tags',
        'datadog-ci gate evaluate --tags team:frontend',
      ],
      [
        'Evaluate matching quality gate rules in Datadog from the datadoghq.eu site',
        'DD_SITE=datadoghq.eu datadog-ci gate evaluate',
      ],
      [
        'Evaluate matching quality gate rules in Datadog with a timeout of 120 seconds',
        'datadog-ci gate evaluate --timeout 120',
      ],
      ['Evaluate matching quality gate rules in Datadog without waiting', 'datadog-ci gate evaluate --no-wait'],
    ],
  })

  private initialRetryMs = 1000
  private maxRetries = 5
  private defaultTimeout = 600 // 10 min

  private dryRun = Option.Boolean('--dry-run', false)
  private failOnEmpty = Option.Boolean('--fail-on-empty', false)
  private failIfUnavailable = Option.Boolean('--fail-if-unavailable', false)
  private noWait = Option.Boolean('--no-wait', false)
  private timeoutInSeconds = Option.String('--timeout', String(this.defaultTimeout), {
    validator: validation.isInteger(),
  })
  private userScope = Option.Array('--scope')
  private tags = Option.Array('--tags')

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private config = {
    apiKey: process.env.DD_API_KEY,
    appKey: process.env.DD_APP_KEY,
    envVarTags: process.env.DD_TAGS,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute() {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    const options: PayloadOptions = {
      dryRun: this.dryRun,
      noWait: this.noWait,
    }

    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()
    const headRef = spanTags[GIT_PULL_REQUEST_BASE_BRANCH]

    if (headRef) {
      const headSha = spanTags[GIT_HEAD_SHA]
      if (headSha) {
        options.pull_request_sha = headSha
      } else {
        this.logger.warn('Detected a pull request run but HEAD commit SHA could not be extracted.')
      }
    }

    const userScope = this.userScope ? parseScope(this.userScope) : {}

    const startTimeMs = new Date().getTime()
    const payload = {
      requestId: uuidv4(),
      spanTags,
      userScope,
      startTimeMs,
      options,
    }

    return this.evaluateRules(api, payload)
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DD_API_KEY')} in your environment.\n`)
      throw new Error('API key is missing')
    }

    if (!this.config.appKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DD_APP_KEY')} in your environment.\n`)
      throw new Error('App key is missing')
    }

    return apiConstructor(getBaseIntakeUrl(), this.config.apiKey, this.config.appKey)
  }

  private async getSpanTags(): Promise<SpanTags> {
    const ciSpanTags = getCISpanTags()
    const gitSpanTags = await getGitMetadata()
    const userGitSpanTags = getUserGitSpanTags()

    const envVarTags = this.config.envVarTags ? parseTags(this.config.envVarTags.split(',')) : {}
    const cliTags = this.tags ? parseTags(this.tags) : {}

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
      ...cliTags,
      ...envVarTags,
    }
  }

  private async evaluateRules(api: APIHelper, evaluateRequest: Payload): Promise<number> {
    this.context.stdout.write(renderGateEvaluationInput(evaluateRequest))

    /**
     * `retryRequest` does not allow setting a wait time dependent on a backend response,
     * so we handle the wait time in `evaluateRulesWithWait`: we'll wait whatever is necessary
     * for the returned promise to be rejected. The retry will start immediately after
     * and will be handled by `retryRequest`.
     */
    return retryRequest((bail, attempt) => this.evaluateRulesWithWait(api, evaluateRequest, attempt, bail), {
      onRetry: (e, attempt) => {
        // render retry message if error is not wait
        if (e.message !== 'wait') {
          this.context.stderr.write(renderEvaluationRetry(attempt, e))
        }
      },
      retries: this.maxRetries,
      maxTimeout: 0,
      minTimeout: 0,
    })
      .then((response) => {
        return this.handleEvaluationSuccess(response.data.data.attributes)
      })
      .catch((error) => {
        return this.handleEvaluationError(error)
      })
  }

  /**
   * Evaluate gate rules and return a promise that will behave as follows:
   * - If the request is successful, the promise will be resolved with the response
   * - If the request is successful but the status is 'wait', the promise will be rejected after the received wait time (wait_time_ms)
   * - If the request is not successful, the promise will be rejected after `initialRetryMs`, with an exponential factor that depends on the attempt (exponential backoff).
   * - If the command execution time is greater than the command timeout, we bail to avoid retrying.
   * If the promise is rejected, `retryRequest` will handle the retry immediately.
   */
  private async evaluateRulesWithWait(
    api: APIHelper,
    evaluateRequest: Payload,
    attempt?: number,
    bail?: (e: Error) => void
  ): Promise<AxiosResponse<EvaluationResponsePayload>> {
    const timePassed = new Date().getTime() - evaluateRequest.startTimeMs
    const remainingWait = this.timeoutInSeconds * 1000 - timePassed

    return new Promise((resolve, reject) => {
      const request = {...evaluateRequest, options: {...evaluateRequest.options}}
      if (remainingWait <= 0 || attempt === this.maxRetries + 1) {
        request.options.isLastRetry = true
      }

      api
        .evaluateGateRules(request, this.context.stdout.write.bind(this.context.stdout))
        .then((response) => {
          if (remainingWait <= 0) {
            bail?.(new Error('wait'))

            return
          }
          if (response.data.data.attributes.status === 'wait') {
            this.context.stdout.write(renderWaiting())
            const waitTime = response.data.data.attributes.metadata?.wait_time_ms ?? 0
            setTimeout(() => {
              reject(new Error('wait'))
            }, Math.min(remainingWait, waitTime))
          } else {
            resolve(response)
          }
        })
        .catch((err) => {
          if (remainingWait <= 0) {
            bail?.(new Error('wait'))

            return
          }
          setTimeout(() => {
            reject(err)
          }, Math.min(remainingWait, this.getDelay(attempt ?? 1)))
        })
    })
  }

  private getDelay(attempt: number): number {
    return 2 ** attempt * this.initialRetryMs
  }

  private handleEvaluationSuccess(evaluationResponse: EvaluationResponse) {
    this.context.stdout.write(renderEvaluationResponse(evaluationResponse))

    if (evaluationResponse.status === 'failed' || (evaluationResponse.status === 'empty' && this.failOnEmpty)) {
      return 1
    }

    return 0
  }

  private handleEvaluationError(error: any) {
    this.context.stderr.write(renderGateEvaluationError(error, this.failIfUnavailable))
    if (is4xxError(error) || ((is5xxError(error) || isTimeout(error)) && this.failIfUnavailable)) {
      return 1
    }

    return 0
  }
}
