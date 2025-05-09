import {Command, Option} from 'clipanion'

import {makeTerminalLink} from '../../helpers/utils'

import {BaseCommand, RecursivePartial} from './base-command'
import {deployTests} from './deploy-tests-lib'
import {DeployTestsCommandConfig} from './interfaces'

const datadogDocsBaseUrl = 'https://docs.datadoghq.com'

const $1 = makeTerminalLink(`${datadogDocsBaseUrl}/continuous_testing/cicd_integrations/configuration#test-files`)

export class DeployTestsCommand extends BaseCommand {
  public static paths = [['synthetics', 'deploy-tests']]

  public static usage = Command.Usage({
    category: 'Synthetics',
    description: 'Deploy Local Test Definitions as Main Test Definitions in Datadog.',
    details: `
      This command deploys Local Test Definitions as Main Test Definitions in Datadog, usually when a feature branch is merged or during a deployment.
    `,
    examples: [
      [
        'Explicitly specify the local test definitions to deploy',
        'datadog-ci synthetics deploy-tests --public-id pub-lic-id1 --public-id pub-lic-id2',
      ],
      [
        'Override the default glob pattern',
        'datadog-ci synthetics deploy-tests -f ./component-1/**/*.synthetics.json -f ./component-2/**/*.synthetics.json',
      ],
    ],
  })

  protected config: DeployTestsCommandConfig = DeployTestsCommand.getDefaultConfig()

  private files = Option.Array('-f,--files', {
    description: `Glob patterns to detect Synthetic ${$1`test configuration files`}}.`,
  })
  private publicIds = Option.Array('-p,--public-id', {description: 'Public IDs of Synthetic tests to deploy.'})
  private subdomain = Option.String('--subdomain', {
    description:
      'The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`.',
  })

  public static getDefaultConfig(): DeployTestsCommandConfig {
    return {
      ...super.getDefaultConfig(),
      files: [],
      publicIds: [],
      subdomain: 'app',
    }
  }

  public async execute() {
    // populate the config
    await this.setup()

    try {
      await deployTests(this.reporter, this.config)
    } catch (error) {
      this.logger.error(`Error: ${error.message}`)

      return 1
    }

    return 0
  }

  protected resolveConfigFromEnv(): RecursivePartial<DeployTestsCommandConfig> {
    return {
      ...super.resolveConfigFromEnv(),
      files: process.env.DATADOG_SYNTHETICS_FILES?.split(';'),
      publicIds: process.env.DATADOG_SYNTHETICS_PUBLIC_IDS?.split(';'),
      subdomain: process.env.DATADOG_SUBDOMAIN,
    }
  }

  protected resolveConfigFromCli(): RecursivePartial<DeployTestsCommandConfig> {
    return {
      ...super.resolveConfigFromCli(),
      files: this.files,
      publicIds: this.publicIds,
      subdomain: this.subdomain,
    }
  }
}
