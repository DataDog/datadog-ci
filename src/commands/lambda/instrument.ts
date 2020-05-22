import {Lambda} from 'aws-sdk'
import {Command} from 'clipanion'
import {getLambdaConfigs, InstrumentationSettings} from './function'

export class InstrumentCommand extends Command {
  private dryRun = false
  private forwarderARN?: string
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
      forwarderARN: this.forwarderARN,
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
    if (this.dryRun) {
      console.log(JSON.stringify(configs, undefined, 3))
    }

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
