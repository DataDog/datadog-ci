/* eslint-disable import-x/order */
import {LambdaCloudwatchCommand} from './cloudwatch'
import {LambdaFlareCommand} from './flare'
import {LambdaInstrumentCommand} from './instrument'
import {LambdaUninstrumentCommand} from './uninstrument'

// prettier-ignore
export const commands = [
  LambdaCloudwatchCommand,
  LambdaFlareCommand,
  LambdaInstrumentCommand,
  LambdaUninstrumentCommand,
]
