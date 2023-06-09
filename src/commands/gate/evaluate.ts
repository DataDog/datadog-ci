import chalk from 'chalk'
import {Command} from 'clipanion'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {retryRequest} from '../../helpers/retry'
import {parseTags} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, EvaluationResponse, Payload} from './interfaces'
import {
  renderDryRunEvaluation,
  renderEvaluationResponse,
  renderGateEvaluationInput,
  renderGateEvaluationError,
  renderEvaluationRetry,
} from './renderer'
import {getBaseIntakeUrl, is4xxError, is5xxError, parseScope} from './utils'

export class GateEvaluateCommand extends Command {
  // TODO add usage

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY,
    envVarTags: process.env.DD_TAGS,
  }

  private dryRun = false
  private failOnEmpty = false
  private failIfUnavailable = false
  private userScope?: string[]
  private tags?: string[]

  public async execute() {
    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()
    const userScope = this.userScope ? parseScope(this.userScope) : {}

    const payload = {
      spanTags,
      userScope,
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
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunEvaluation())

      return 0
    }

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
}

GateEvaluateCommand.addPath('gate', 'evaluate')
GateEvaluateCommand.addOption('dryRun', Command.Boolean('--dry-run'))
GateEvaluateCommand.addOption('failOnEmpty', Command.Boolean('--fail-on-empty'))
GateEvaluateCommand.addOption('failIfUnavailable', Command.Boolean('--fail-if-unavailable'))
GateEvaluateCommand.addOption('userScope', Command.Array('--scope'))
GateEvaluateCommand.addOption('tags', Command.Array('--tags'))
