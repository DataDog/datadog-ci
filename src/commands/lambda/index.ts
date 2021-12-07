import { Lambda } from 'aws-sdk'
import {bold, yellow} from 'chalk'
import {Command} from 'clipanion/lib/advanced'
import { Runtime } from './constants'
import {findLatestLayerVersion, isMissingAWSCredentials, isMissingDatadogEnvVars} from './functions/commons'

import {InstrumentCommand} from './instrument'
import {requestAWSCredentials, requestDatadogEnvVars} from './prompt'
import {UninstrumentCommand} from './uninstrument'

class LambdaCommand extends Command {
  public async execute() {
    if (isMissingAWSCredentials()) {
      this.context.stdout.write(`${bold(yellow('[!]'))} AWS Credentials are missing, let's set them up!\n`)
      await requestAWSCredentials()
    }
    if (isMissingDatadogEnvVars()) {
      this.context.stdout.write(`${bold(yellow('[!]'))} Datadog Environment Variables are needed.\n`)
      await requestDatadogEnvVars()
    }
  }
}

LambdaCommand.addPath('lambda')

module.exports = [InstrumentCommand, LambdaCommand, UninstrumentCommand]
