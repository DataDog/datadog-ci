import chalk from 'chalk'
import {Command} from 'clipanion'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {CI_PIPELINE_NAME, GIT_BRANCH, GIT_REPOSITORY_URL} from '../../helpers/tags'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, EvaluationResponse, Payload} from './interfaces'
import {
  renderDryRunEvaluation,
  renderEvaluationResponse,
  renderGateEvaluationInput,
  renderGateEvaluationError,
  renderMissingRequiredTag,
  renderMissingTagsError,
} from './renderer'
import {getBaseIntakeUrl} from './utils'

export class GateEvaluateCommand extends Command {
  // TODO add usage

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY,
  }

  private dryRun = false
  private failOnEmpty = false
  private allowPartialEvaluation = false

  public async execute() {
    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()

    if (!this.allowPartialEvaluation && !this.hasRequiredTags(spanTags)) {
      this.context.stderr.write(renderMissingTagsError())

      return 1
    }

    const payload = {
      spanTags,
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

    return {
      ...gitSpanTags,
      ...ciSpanTags,
      ...userGitSpanTags,
    }
  }

  private hasRequiredTags(spanTags: SpanTags): boolean {
    let result = true

    if (!spanTags[GIT_BRANCH]) {
      this.context.stderr.write(renderMissingRequiredTag('Branch Name'))
      result = false
    }

    if (!spanTags[GIT_REPOSITORY_URL]) {
      this.context.stderr.write(renderMissingRequiredTag('Repository URL'))
      result = false
    }

    if (!spanTags[CI_PIPELINE_NAME]) {
      this.context.stderr.write(renderMissingRequiredTag('Pipeline Name'))
      result = false
    }

    return result
  }

  private async evaluateRules(api: APIHelper, evaluateRequest: Payload): Promise<number> {
    this.context.stdout.write(renderGateEvaluationInput(evaluateRequest.spanTags))
    if (this.dryRun) {
      this.context.stdout.write(renderDryRunEvaluation())

      return 0
    }

    // To be extended with retries, error handling, etc.
    return api
      .evaluateGateRules(evaluateRequest, this.context.stdout.write.bind(this.context.stdout))
      .then((response) => {
        return this.handleEvaluationResponse(response.data.data.attributes)
      })
      .catch((error) => {
        // TODO Handle unavailability etc.
        this.context.stderr.write(renderGateEvaluationError(error))

        return 1
      })
  }

  private handleEvaluationResponse(evaluationResponse: EvaluationResponse): number {
    this.context.stdout.write(renderEvaluationResponse(evaluationResponse))

    if (evaluationResponse.status === 'failed' || (evaluationResponse.status === 'empty' && this.failOnEmpty)) {
      return 1
    } else {
      return 0
    }
  }
}

GateEvaluateCommand.addPath('gate', 'evaluate')
GateEvaluateCommand.addOption('dryRun', Command.Boolean('--dry-run'))
GateEvaluateCommand.addOption('failOnEmpty', Command.Boolean('--fail-on-empty'))
GateEvaluateCommand.addOption('allowPartialEvaluation', Command.Boolean('--allow-partial-evaluation'))
