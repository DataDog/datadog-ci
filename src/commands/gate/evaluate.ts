import chalk from 'chalk'
import {Command} from 'clipanion'

import {getCISpanTags} from '../../helpers/ci'
import {getGitMetadata} from '../../helpers/git/format-git-span-data'
import {SpanTags} from '../../helpers/interfaces'
import {getUserGitSpanTags} from '../../helpers/user-provided-git'

import {apiConstructor} from './api'
import {APIHelper, Payload} from './interfaces'
import {getBaseIntakeUrl} from './utils'

export class GateEvaluateCommand extends Command {
  // TODO add usage

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    appKey: process.env.DATADOG_APP_KEY,
  }
  private dryRun = false

  public async execute() {
    const api = this.getApiHelper()
    const spanTags = await this.getSpanTags()
    const payload = {
      spanTags,
    }

    await this.evaluateRules(api, payload)
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

  private async evaluateRules(api: APIHelper, evaluateRequest: Payload) {
    if (this.dryRun) {
      // TODO All writes will be moved to renderer in next iterations
      this.context.stderr.write('Dry run mode is enabled. Not evaluating the rules.')

      return
    }

    // To be extended
    try {
      await api.evaluateGateRules(evaluateRequest, this.context.stdout.write.bind(this.context.stdout))
    } catch (error) {
      this.context.stderr.write(error)
    }
  }
}

GateEvaluateCommand.addPath('gate', 'evaluate')
GateEvaluateCommand.addOption('dryRun', Command.Boolean('--dry-run'))
