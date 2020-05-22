import {Lambda} from 'aws-sdk'
import {Command} from 'clipanion'
import {getLambdaConfigs, InstrumentationSettings, updateLambdaConfigs} from './function'

export class InstrumentCommand extends Command {
  private dryRun = false
  private functions: string[] = []
  private layerAWSAccount?: string
  private layerVersion?: string
  private region?: string

  public async execute() {
    if (this.layerVersion === undefined) {
      this.context.stdout.write('No layer version specified. Use -v,--layerVersion\n')

      return 1
    }
    const layerVersion = parseInt(this.layerVersion, 10)
    if (Number.isNaN(layerVersion)) {
      this.context.stdout.write(`Invalid layer version ${layerVersion}.\n`)

      return 1
    }

    const settings: InstrumentationSettings = {
      layerAWSAccount: this.layerAWSAccount,
      layerVersion,
      mergeXrayTraces: false,
      region: this.region ?? 'us-east-1',
      tracingEnabled: false,
    }

    if (this.functions.length === 0) {
      this.context.stdout.write('No functions specified for implementation.\n')
    }
    const lambda = new Lambda({region: this.region})
    const configs = await getLambdaConfigs(lambda, this.functions, settings)
    const prefix = this.dryRun ? '[Dry Run] ' : ''
    if (configs.length === 0) {
      this.context.stdout.write(`${prefix}No updates will be applied\n`)

      return 0
    }
    this.context.stdout.write(`${prefix}Will apply the following updates:\n`)
    for (const config of configs) {
      this.context.stdout.write(
        `UpdateFunctionConfiguration -> ${config.functionARN}\n${JSON.stringify(config.updateRequest, undefined, 2)}\n`
      )
    }
    if (this.dryRun) {
      return 0
    }

    await updateLambdaConfigs(lambda, configs)

    return 0
  }
}

InstrumentCommand.addPath('lambda', 'instrument')
InstrumentCommand.addOption('functions', Command.Array('-f,--function'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('layerVersion', Command.String('-v,--layerVersion'))
InstrumentCommand.addOption('layerAWSAccount', Command.String('-a,--layerAccount'))
InstrumentCommand.addOption('forwarderARN', Command.String('--forwarder'))
InstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
