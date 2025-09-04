import {PluginCommand as RunTestsCommand} from './commands/run-tests'
import {DeployTestsCommand} from './deploy-tests-command'
import {ImportTestsCommand} from './import-tests-command'
import {UploadApplicationCommand} from './upload-application-command'

module.exports = [RunTestsCommand, UploadApplicationCommand, ImportTestsCommand, DeployTestsCommand]
