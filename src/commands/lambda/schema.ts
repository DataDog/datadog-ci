import type {ExtractCommandConfig} from '../../helpers/config'
import type {LambdaFlareCommand} from './flare'
import type {InstrumentCommand} from './instrument'
import type {UninstrumentCommand} from './uninstrument'

export type LambdaConfig = ExtractCommandConfig<InstrumentCommand> &
  ExtractCommandConfig<UninstrumentCommand> &
  ExtractCommandConfig<LambdaFlareCommand>
