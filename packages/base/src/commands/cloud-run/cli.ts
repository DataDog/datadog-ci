/* eslint-disable import-x/order */
import {CloudRunFlareCommand} from './flare'
import {CloudRunInstrumentCommand} from './instrument'
import {CloudRunUninstrumentCommand} from './uninstrument'

// prettier-ignore
export const commands = [
  CloudRunFlareCommand,
  CloudRunInstrumentCommand,
  CloudRunUninstrumentCommand,
]
