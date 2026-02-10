/* eslint-disable import-x/order */
import {LambdaDisableCloudwatchCommand} from './disable-cloudwatch'
import {LambdaEnableCloudwatchCommand} from './enable-cloudwatch'
import {LambdaFlareCommand} from './flare'
import {LambdaInstrumentCommand} from './instrument'
import {LambdaUninstrumentCommand} from './uninstrument'

// prettier-ignore
export const commands = [
  LambdaDisableCloudwatchCommand,
  LambdaEnableCloudwatchCommand,
  LambdaFlareCommand,
  LambdaInstrumentCommand,
  LambdaUninstrumentCommand,
]
