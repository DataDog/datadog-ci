/* eslint-disable import-x/order */
import {ContainerAppInstrumentCommand} from './instrument'
import {ContainerAppUninstrumentCommand} from './uninstrument'

// prettier-ignore
export const commands = [
  ContainerAppInstrumentCommand,
  ContainerAppUninstrumentCommand,
]
