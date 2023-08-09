import chalk from 'chalk'
import {Command, Option} from 'clipanion'
import {v4 as uuidv4} from 'uuid'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, EvaluationResponse, Payload} from './interfaces'
import {
  renderEvaluationResponse,
  renderGateEvaluationInput,
  renderGateEvaluationError,
  renderEvaluationRetry,
  renderWaiting,
} from './renderer'
import {getBaseIntakeUrl, is4xxError, is5xxError, parseScope} from './utils'

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
        'DATADOG_SITE=datadoghq.eu datadog-ci gate evaluate',
      ],
      ['Evaluate matching quality gate rules in Datadog without waiting', 'datadog-ci gate evaluate --no-wait'],
    ],
  })

  private dryRun = Option.Boolean('--dry-run', false)
  private failOnEmpty = Option.Boolean('--fail-on-empty', false)
  private failIfUnavailable = Option.Boolean('--fail-if-unavailable', false)
  private noWait = Option.Boolean('--no-wait', false)
  private userScope = Option.Array('--scope')
  private tags = Option.Array('--tags')

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY || process.env.DD_APP_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private waitingTime = 30000 // 30 seconds

  public async execute() {
    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()
    const userScope = this.userScope ? parseScope(this.userScope) : {}

    const payload = {
      requestId: uuidv4(),
      spanTags,
      userScope,
      options: {
        dryRun: this.dryRun,
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
    if (this.shouldWait()) {
      this.context.stdout.write(renderWaiting())
      await this.delay(this.waitingTime)
    }

    this.context.stdout.write(renderGateEvaluationInput(evaluateRequest))

    return retryRequest(
      () => api.evaluateGateRules(evaluateRequest, this.context.stdout.write.bind(this.context.stdout)),
      {
        onRetry: (e, attempt) => {
          this.context.stderr.write(renderEvaluationRetry(attempt, e))
        },
        retries: 5,
      }
    )
      .then((response) => {
        return this.handleEvaluationSuccess(response.data.data.attributes)
      })
      .catch((error) => {
        return this.handleEvaluationError(error)
      })
  }

  private handleEvaluationSuccess(evaluationResponse: EvaluationResponse): number {
    this.context.stdout.write(renderEvaluationResponse(evaluationResponse))

    if (evaluationResponse.status === 'failed' || (evaluationResponse.status === 'empty' && this.failOnEmpty)) {
      return 1
    }

    return 0
  }

  private handleEvaluationError(error: any): number {
    this.context.stderr.write(renderGateEvaluationError(error, this.failIfUnavailable))
    if (is4xxError(error) || (is5xxError(error) && this.failIfUnavailable)) {
      return 1
    }

    return 0
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms))
  }

  private shouldWait(): boolean {
    return !this.dryRun && !this.noWait
  }
}
