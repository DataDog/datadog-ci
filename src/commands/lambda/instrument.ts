import {Lambda} from 'aws-sdk'
import {Command} from 'clipanion'
import {FunctionConfiguration, getLambdaConfigs, InstrumentationSettings, updateLambdaConfigs} from './function'
import {LambdaConfigOptions} from './interfaces'
import {parseConfigFile} from '../../helpers/utils'

export class InstrumentCommand extends Command {
  private awsAccessKeyId?: string
  private awsSecretAccessKey?: string

  private config: LambdaConfigOptions = {
    awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
    awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    functions: [],
    region: process.env.AWS_DEFAULT_REGION,
    tracing: true,
  }
  private configPath?: string
  private dryRun = false
  private functions: string[] = []
  private layerAWSAccount?: string
  private layerVersion?: string
  private mergeXrayTraces?: boolean
  private region?: string
  private tracing?: boolean

  public async execute() {
    this.config = await parseConfigFile(this.config, this.configPath)

    const settings = this.getSettings()
    if (settings === undefined) {
      return 1
    }

    if (this.functions.length === 0) {
      this.context.stdout.write('No functions specified for instrumentation.\n')

      return 1
    }
    const functionGroups = this.collectFunctionsByRegion()
    if (functionGroups === undefined) {
      return 1
    }

    const configGroups: {
      [region: string]: {
        configs: FunctionConfiguration[]
        lambda: Lambda
      }
    } = {}
    for (const [region, functionList] of Object.entries(functionGroups)) {
      const lambda = this.getLambdaService(region)
      const configs = await getLambdaConfigs(lambda, region, functionList, settings)
      configGroups[region] = {configs, lambda}
    }
    const configList = Object.values(configGroups)
      .map((group) => group.configs)
      .reduce((a, b) => a.concat(b))
    this.printPlannedActions(configList)
    if (this.dryRun || configList.length === 0) {
      return 0
    }
    const promises = Object.values(configGroups).map((group) => updateLambdaConfigs(group.lambda, group.configs))
    await Promise.all(promises)

    return 0
  }

  private collectFunctionsByRegion() {
    const functions = this.functions.length !== 0 ? this.functions : this.config.functions
    const defaultRegion = this.region || this.config.region
    const groups: {[key: string]: string[]} = {}
    const regionless: string[] = []
    for (const func of functions) {
      const region = this.getRegion(func) ?? defaultRegion
      if (region === undefined) {
        regionless.push(func)
        continue
      }
      if (groups[region] === undefined) {
        groups[region] = []
      }
      const group = groups[region]
      group.push(func)
    }
    if (regionless.length > 0) {
      this.context.stdout.write(
        `'No default region specified for ${JSON.stringify(regionless)}. Use -r,--region, or use a full functionARN\n`
      )

      return
    }

    return groups
  }

  private getLambdaService(region: string) {
    const accessKeyId = this.awsAccessKeyId ?? this.config.awsAccessKeyId
    const secretAccessKey = this.awsSecretAccessKey ?? this.config.awsSecretAccessKey

    return new Lambda({region, accessKeyId, secretAccessKey})
  }
  private getRegion(functionARN: string) {
    const [, , , region] = functionARN.split(':')

    return region === undefined || region === '*' ? undefined : region
  }

  private getSettings(): InstrumentationSettings | undefined {
    const layerVersionStr = this.layerVersion ?? this.config.layerVersion
    const layerAWSAccount = this.layerAWSAccount ?? this.config.layerAWSAccount
    if (layerVersionStr === undefined) {
      this.context.stdout.write('No layer version specified. Use -v,--layerVersion\n')

      return
    }
    const layerVersion = parseInt(layerVersionStr, 10)
    if (Number.isNaN(layerVersion)) {
      this.context.stdout.write(`Invalid layer version ${layerVersion}.\n`)

      return
    }
    const mergeXrayTraces = this.mergeXrayTraces ?? this.config.mergeXrayTraces ?? true
    const tracingEnabled = this.tracing ?? this.config.tracing ?? true

    return {
      layerAWSAccount,
      layerVersion,
      mergeXrayTraces,
      tracingEnabled,
    }
  }

  private printPlannedActions(configs: FunctionConfiguration[]) {
    const prefix = this.dryRun ? '[Dry Run] ' : ''

    if (configs.length === 0) {
      this.context.stdout.write(`${prefix}No updates will be applied\n`)

      return
    }
    this.context.stdout.write(`${prefix}Will apply the following updates:\n`)
    for (const config of configs) {
      this.context.stdout.write(
        `UpdateFunctionConfiguration -> ${config.functionARN}\n${JSON.stringify(config.updateRequest, undefined, 2)}\n`
      )
    }
  }
}

InstrumentCommand.addPath('lambda', 'instrument')
InstrumentCommand.addOption('functions', Command.Array('-f,--function'))
InstrumentCommand.addOption('region', Command.String('-r,--region'))
InstrumentCommand.addOption('layerVersion', Command.String('-v,--layerVersion'))
InstrumentCommand.addOption('layerAWSAccount', Command.String('-a,--layerAccount'))
InstrumentCommand.addOption('awsAccessKeyId', Command.String('--awsAccessKeyId'))
InstrumentCommand.addOption('awsSecretAccessKey', Command.String('--awsSecretAccessKey'))
InstrumentCommand.addOption('tracing', Command.Boolean('--tracing'))
InstrumentCommand.addOption('mergeXrayTraces', Command.Boolean('--mergeXrayTraces'))
InstrumentCommand.addOption('dryRun', Command.Boolean('-d,--dry'))
InstrumentCommand.addOption('configPath', Command.String('--config'))
