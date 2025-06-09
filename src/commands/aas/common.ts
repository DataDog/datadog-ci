import type {PagedAsyncIterableIterator} from '@azure/core-paging'

import {Command, Option} from 'clipanion'

import {dryRunTag} from '../../helpers/renderer'
import {DEFAULT_CONFIG_PATHS, resolveConfigFromFile} from '../../helpers/utils'

import {AasConfigOptions, ValueOptional} from './interfaces'

export const SIDECAR_CONTAINER_NAME = 'datadog-sidecar'
export const SIDECAR_IMAGE = 'index.docker.io/datadog/serverless-init:latest'
export const SIDECAR_PORT = '8126'

export abstract class AasCommand extends Command {
  public dryRun = Option.Boolean('-d,--dry-run', false, {
    description: 'Run the command in dry-run mode, without making any changes',
  })
  private subscriptionId = Option.String('-s,--subscription-id', {
    description: 'Azure Subscription ID containing the App Service',
  })
  private resourceGroup = Option.String('-g,--resource-group', {
    description: 'Name of the Azure Resource Group containing the App Service',
  })
  private aasName = Option.String('-n,--name', {
    description: 'Name of the Azure App Service to instrument',
  })
  private configPath = Option.String('--config', {
    description: 'Path to the configuration file',
  })
  private service = Option.String('--service', {
    description: 'How you want to tag your service. For example, `my-service`',
  })
  private environment = Option.String('--env,--environment', {
    description: 'How you want to tag your env. For example, `prod`',
  })
  private isInstanceLoggingEnabled = Option.Boolean('--instance-logging', false, {
    description:
      'When enabled, log collection is automatically configured for an additional file path: /home/LogFiles/*$COMPUTERNAME*.log',
  })
  private logPath = Option.String('--log-path', {
    description: 'Where you write your logs. For example, /home/LogFiles/*.log or /home/LogFiles/myapp/*.log',
  })

  public get dryRunPrefix(): string {
    return this.dryRun ? dryRunTag + ' ' : ''
  }

  public async ensureConfig(): Promise<[AasConfigOptions, string[]]> {
    const config = (
      await resolveConfigFromFile<{aas: ValueOptional<AasConfigOptions>}>(
        {
          aas: {
            subscriptionId: this.subscriptionId,
            resourceGroup: this.resourceGroup,
            aasName: this.aasName,
            service: this.service,
            environment: this.environment,
            isInstanceLoggingEnabled: this.isInstanceLoggingEnabled,
            logPath: this.logPath,
          },
        },
        {
          configPath: this.configPath,
          defaultConfigPaths: DEFAULT_CONFIG_PATHS,
        }
      )
    ).aas
    const errors: string[] = []
    if (process.env.DD_API_KEY === undefined) {
      errors.push('DD_API_KEY environment variable is required')
    }
    if (!this.subscriptionId) {
      errors.push('--subscription-id is required')
    }
    if (!this.resourceGroup) {
      errors.push('--resource-group is required')
    }
    if (!this.aasName) {
      errors.push('App Service (--name) is required')
    }

    return [config as AasConfigOptions, errors]
  }
}

export const collect = async <T>(it: PagedAsyncIterableIterator<T>): Promise<T[]> => {
  const arr = []
  for await (const x of it) {
    arr.push(x)
  }

  return arr
}

export const equal = (x: unknown, y: unknown): boolean => {
  return x && y && typeof x === 'object' && typeof x === typeof y
    ? Object.keys(x).length === Object.keys(y).length &&
        Object.keys(x).every((key) => equal((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key]))
    : x === y
}
