import {PluginCommand as CloudRunFlareCommand} from './flare'
import {PluginCommand as InstrumentCommand} from './instrument'
import {PluginCommand as UninstrumentCommand} from './uninstrument'

module.exports = [CloudRunFlareCommand, InstrumentCommand, UninstrumentCommand]
