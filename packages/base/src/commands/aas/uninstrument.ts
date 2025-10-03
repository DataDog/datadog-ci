import {Command} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {AasCommand} from './common'

export class AasUninstrumentCommand extends AasCommand {
  public static paths = [['aas', 'uninstrument']]
  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Remove Datadog instrumentation from an Azure App Service.',
  })

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
