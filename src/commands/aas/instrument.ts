import {Command} from 'clipanion'
import {AasCommand} from './common'
import {DefaultAzureCredential} from '@azure/identity'
import {WebSiteManagementClient} from '@azure/arm-appservice'
import {renderError, renderSoftWarning} from '../../helpers/renderer'

export class InstrumentCommand extends AasCommand {
  public static paths = [['aas', 'instrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Apply Datadog instrumentation to an Azure App Service.',
  })

  public async execute(): Promise<0 | 1> {
    const [config, errors] = await this.ensureConfig()
    if (errors.length > 0) {
      for (const error of errors) {
        this.context.stdout.write(renderError(error))
      }
      return 1
    }
    this.context.stdout.write(`${this.dryRunPrefix}🐶 Instrumenting Azure App Service\n`)
    const client = new WebSiteManagementClient(new DefaultAzureCredential(), config.subscriptionId)
    const app = await client.webApps.get(config.resourceGroup, config.aasName)
    if (app.kind && !app.kind.toLowerCase().includes('linux')) {
        this.context.stdout.write(
          renderSoftWarning(
            `Only Linux-based Azure App Services are currently supported. 
Please see the documentation for information on 
how to instrument Windows-based App Services: 
https://docs.datadoghq.com/serverless/azure_app_services/azure_app_services_windows`
          )
        )
        return 1
    }
    this.context.stdout.write(`Application: ${JSON.stringify(app, undefined, 2)}\n`)
    return 0
  }
}
