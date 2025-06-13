import chalk from 'chalk'
import {Command, Option} from 'clipanion'

import {DATADOG_SITE_US1} from '../../constants'
import {newApiKeyValidator} from '../../helpers/apikey'
import {renderSoftWarning} from '../../helpers/renderer'
import {maskString} from '../../helpers/utils'

import {CloudRunConfigOptions} from './interfaces'
import {renderAuthenticationInstructions, renderCloudRunInstrumentUninstrumentHeader} from './renderer'
import {checkAuthentication} from './utils'

export class InstrumentCommand extends Command {
  // TODO uncomment when commnand is ready and add to docs: https://github.com/DataDog/datadog-ci#cloud-run
  public static paths = [['cloud-run', 'instrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to a Cloud Run app.',
  })

  private configPath = Option.String('--config') // todo
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false) // todo
  private environment = Option.String('--env') // todo
  private extraTags = Option.String('--extra-tags,--extraTags') // todo
  private project = Option.String('-p,--project') // todo
  private services = Option.Array('-s,--service,--services', []) // todo
  private interactive = Option.Boolean('-i,--interactive', false) // todo
  private logging = Option.String('--logging') // todo
  private logLevel = Option.String('--log-level,--logLevel') // todo
  private regExPattern = Option.String('--services-regex,--servicesRegex') // todo
  private region = Option.String('-r,--region') // todo
  private sourceCodeIntegration = Option.Boolean('-s,--source-code-integration,--sourceCodeIntegration', true) // todo
  private uploadGitMetadata = Option.Boolean('-u,--upload-git-metadata,--uploadGitMetadata', true) // todo
  private tracing = Option.String('--tracing') // todo
  private version = Option.String('--version') // todo
  private llmobs = Option.String('--llmobs') // todo

  private config: CloudRunConfigOptions = {
    services: [],
    tracing: 'true',
    logging: 'true',
  }

  public async execute(): Promise<0 | 1> {
    // TODO FIPS

    this.context.stdout.write(
      chalk.bold(renderCloudRunInstrumentUninstrumentHeader(Object.getPrototypeOf(this), this.dryRun))
    )

    // TODO resolve config from file
    // TODO dry run
    // TODO interactive

    // Verify DD API Key
    const isApiKeyValid = await newApiKeyValidator({
      apiKey: process.env.DD_API_KEY,
      datadogSite: process.env.DD_SITE ?? DATADOG_SITE_US1,
    }).validateApiKey()
    if (!isApiKeyValid) {
      this.context.stdout.write(
        renderSoftWarning(
          `Invalid API Key stored in the environment variable ${chalk.bold('DD_API_KEY')}: ${maskString(
            process.env.DD_API_KEY ?? ''
          )}\nEnsure you copied the value and not the Key ID.`
        )
      )

      return 1
    }

    // Verify GCP credentials
    this.context.stdout.write(chalk.bold('\n🔑 Verifying GCP credentials...\n'))
    const authenticated = await checkAuthentication()
    if (!authenticated) {
      this.context.stderr.write(renderAuthenticationInstructions())

      return 1
    }
    this.context.stdout.write('GCP credentials verified!\n')

    return Promise.resolve(0)
  }
}
