import {PluginCommand as RunTestsCommand} from './commands/run-tests'
import {PluginCommand as DeployTestsCommand} from './commands/deploy-tests'
import {ImportTestsCommand} from './import-tests-command'
import {PluginCommand as UploadApplicationCommand} from './commands/upload-application'

module.exports = [RunTestsCommand, UploadApplicationCommand, ImportTestsCommand, DeployTestsCommand]
