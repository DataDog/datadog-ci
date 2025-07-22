import type {ExtractCommandConfig} from '../../helpers/config'
import type {RunTestsCommand} from './run-tests-command'
import type {DeployTestsCommand} from './deploy-tests-command'
import type {ImportTestsCommand} from './import-tests-command'
import type {UploadApplicationCommand} from './upload-application-command'

export type SyntheticsConfig = ExtractCommandConfig<RunTestsCommand> &
  ExtractCommandConfig<DeployTestsCommand> &
  ExtractCommandConfig<ImportTestsCommand> &
  ExtractCommandConfig<UploadApplicationCommand>
