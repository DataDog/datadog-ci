import {PluginCommand as LambdaFlareCommand} from './commands/flare'
import {PluginCommand as InstrumentCommand} from './commands/instrument'
import {PluginCommand as UninstrumentCommand} from './commands/uninstrument'

module.exports = [InstrumentCommand, UninstrumentCommand, LambdaFlareCommand]
