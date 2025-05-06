import {Command, Option} from 'clipanion'

import {Logger, LogLevel} from '../../helpers/logger'
import { enableFips } from 'src/helpers/fips'
import { FIPS_IGNORE_ERROR_ENV_VAR } from 'src/constants'
import { toBoolean } from 'src/helpers/env'
import { FIPS_ENV_VAR } from 'src/constants'
import chalk from 'chalk'

export class DeploymentCorrelateImageCommand extends Command {
  public static paths = [['deployment', 'correlate-image']]

  public static usage = Command.Usage({
    category: 'CI Visibility',
    description: 'Correlate images with their source commit.',
    details: `
      This command will correlate the image with a commit of the application repository.
    `,
  })

  private commitSha = Option.String('--commit-sha')
  private repositoryUrl = Option.String('--repository-url')
  private image = Option.String('--image')
  private fips = Option.Boolean('--fips', false)
  private fipsIgnoreError = Option.Boolean('--fips-ignore-error', false)

  private logger: Logger = new Logger((s: string) => this.context.stdout.write(s), LogLevel.INFO)

  private config = {
    apiKey: process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
    fips: toBoolean(process.env[FIPS_ENV_VAR]) ?? false,
    fipsIgnoreError: toBoolean(process.env[FIPS_IGNORE_ERROR_ENV_VAR]) ?? false,
  }

  public async execute(): Promise<number> {
    enableFips(this.fips || this.config.fips, this.fipsIgnoreError || this.config.fipsIgnoreError)

    if (!this.config.apiKey) {
      this.logger.error(
        `Neither ${chalk.red.bold('DATADOG_API_KEY')} nor ${chalk.red.bold('DD_API_KEY')} is in your environment.`
      )
      return 1
    }

    if (!this.commitSha) {
      this.logger.error('Missing commit SHA. It must be provided with --commit-sha')
      return 1
    }

    if (!this.repositoryUrl) {
      this.logger.error('Missing repository URL. It must be provided with --repository-url')
      return 1
    }

    if (!this.image) {
      this.logger.error('Missing image. It must be provided with --image')
      return 1
    }
    
    
    return 0
  }
}