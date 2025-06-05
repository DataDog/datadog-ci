import {Command, Option} from 'clipanion'
import {AasConfigOptions} from './interfaces'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'
import {dryRunTag} from '../../helpers/renderer'

export abstract class AasCommand extends Command {
  private dryRun = Option.Boolean('-d,--dry,--dry-run', false)
  private subscriptionId = Option.String('-s,--subscription-id')
  private resourceGroup = Option.String('-g,--resource-group')
  private aasName = Option.String('-n,--name')
  private configPath = Option.String('--config')

  public get dryRunPrefix(): string {
    return this.dryRun ? dryRunTag + ' ' : ''
  }

  async ensureConfig(): Promise<[AasConfigOptions, string[]]> {
    const config = (
      await resolveConfigFromFile(
        {
          aas: {
            subscriptionId: this.subscriptionId,
            resourceGroup: this.resourceGroup,
            aasName: this.aasName,
          },
        },
        {
          configPath: this.configPath,
          defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        }
      )
    ).aas
    const errors: string[] = []
    if (!this.subscriptionId) {
      errors.push('Subscription ID is required')
    }
    if (!this.resourceGroup) {
      errors.push('Resource Group is required')
    }
    if (!this.aasName) {
      errors.push('AAS Name is required')
    }

    return [config as AasConfigOptions, errors]
  }
}
