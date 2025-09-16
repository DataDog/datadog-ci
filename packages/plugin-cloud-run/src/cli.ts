import {PluginCommand as CloudRunFlareCommand} from './commands/flare'
import {PluginCommand as InstrumentCommand} from './commands/instrument'
import {PluginCommand as UninstrumentCommand} from './commands/uninstrument'

module.exports = [CloudRunFlareCommand, InstrumentCommand, UninstrumentCommand]
