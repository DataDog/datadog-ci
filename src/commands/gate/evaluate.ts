import type {AxiosResponse} from 'axios'

import chalk from 'chalk'
import {Command} from 'clipanion'
import {v4 as uuidv4} from 'uuid'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, EvaluationResponse, EvaluationResponsePayload, Payload} from './interfaces'
import {
  renderEvaluationResponse,
  renderGateEvaluationInput,
  renderGateEvaluationError,
  renderEvaluationRetry,
  renderWaiting,
} from './renderer'
import {getBaseIntakeUrl, is4xxError, is5xxError, parseScope} from './utils'

export class GateEvaluateCommand extends Command {
  public static usage = Command.Usage({
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
        'DATADOG_SITE=datadoghq.eu datadog-ci gate evaluate',
      ],
      ['Evaluate matching quality gate rules in Datadog without waiting', 'datadog-ci gate evaluate --no-wait'],
    ],
  })

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private initialRetryMs = 5000
  private maxRetryTimeMs = 300000
  private maxRetries = 5

  private dryRun = false
  private failOnEmpty = false
  private failIfUnavailable = false
  private noWait = false
  private userScope?: string[]
  private tags?: string[]

  public async execute() {
    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()
    const userScope = this.userScope ? parseScope(this.userScope) : {}

    const startTimeMs = new Date().getTime()
    const payload = {
      requestId: uuidv4(),
      spanTags,
      userScope,
      startTimeMs,
      options: {
        dryRun: this.dryRun,
        noWait: this.noWait,
      },
    }

    return this.evaluateRules(api, payload)
  }

  private getApiHelper(): APIHelper {
    if (!this.config.apiKey) {
      this.context.stdout.write(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.\n`
      )
      throw new Error('API key is missing')
    }

    if (!this.config.appKey) {
      this.context.stdout.write(`Missing ${chalk.red.bold('DATADOG_APP_KEY')} in your environment.\n`)
      throw new Error('APP key is missing')
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
    * for the returned promise to resolve or be rejected. The retry will start immediately after 
    * and will be handled by `retryRequest`.
    */
    return retryRequest((attempt) => this.evaluateRulesWithWait(api, evaluateRequest, attempt), {
      onRetry: (e, attempt) => {
        // render retry message if error is not wait
        if (e.message !== 'wait') {
          this.context.stderr.write(renderEvaluationRetry(attempt, e))
        }
      },
      maxRetryTime: this.maxRetryTimeMs,
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
   * If the promise is rejected, `retryRequest` will handle the retry immediately.
   */
  private async evaluateRulesWithWait(
    api: APIHelper,
    evaluateRequest: Payload,
    attempt?: number
  ): Promise<AxiosResponse<EvaluationResponsePayload>> {
    return new Promise((resolve, reject) => {
      api
        .evaluateGateRules(evaluateRequest, this.context.stdout.write.bind(this.context.stdout))
        .then((response) => {
          if (response.data.data.attributes.status === 'wait') {
            this.context.stdout.write(renderWaiting())
            setTimeout(() => {
              reject(new Error('wait'))
            }, response.data.data.attributes.metadata.wait_time_ms)
          } else {
            resolve(response)
          }
        })
        .catch((err) => {
          setTimeout(() => {
            reject(err)
          }, this.getDelay(attempt ?? 1))
        })
    })
  }

  private getDelay(attempt: number): number {
    return attempt * this.initialRetryMs
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
    if (is4xxError(error) || (is5xxError(error) && this.failIfUnavailable)) {
      return 1
    }

    return 0
  }
}

GateEvaluateCommand.addPath('gate', 'evaluate')
GateEvaluateCommand.addOption('dryRun', Command.Boolean('--dry-run'))
GateEvaluateCommand.addOption('failOnEmpty', Command.Boolean('--fail-on-empty'))
GateEvaluateCommand.addOption('failIfUnavailable', Command.Boolean('--fail-if-unavailable'))
GateEvaluateCommand.addOption('noWait', Command.Boolean('--no-wait'))
GateEvaluateCommand.addOption('userScope', Command.Array('--scope'))
GateEvaluateCommand.addOption('tags', Command.Array('--tags'))
