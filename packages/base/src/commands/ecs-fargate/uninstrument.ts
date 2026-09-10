import type {EcsFargateConfigOptions} from './common'

import {Command, Option} from 'clipanion'

import {executePluginCommand} from '../../helpers/plugin'

import {EcsFargateCommand} from './common'

export class EcsFargateUninstrumentCommand extends EcsFargateCommand {
  public static paths = [['ecs-fargate', 'uninstrument']]

  public static usage = Command.Usage({
    category: 'Serverless',
    description: 'Revert Datadog instrumentation in an AWS ECS Fargate Task Definition.',
  })

  private envVars = Option.Array('-e,--env-vars', {
    description:
      'Additional environment variables to remove from every container in the task. The Datadog ones are removed either way. Can specify multiple variables in the format `--env-vars VAR1=VALUE1 --env-vars VAR2=VALUE2`.',
  })

  public get additionalConfig(): Partial<EcsFargateConfigOptions> {
    return {
      envVars: this.envVars,
    }
  }

  public async execute(): Promise<number | void> {
    return executePluginCommand(this)
  }
}
