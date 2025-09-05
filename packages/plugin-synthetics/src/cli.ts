import {PluginCommand as DeployTestsCommand} from './commands/deploy-tests'
import {PluginCommand as ImportTestsCommand} from './commands/import-tests'
import {PluginCommand as RunTestsCommand} from './commands/run-tests'
import {PluginCommand as UploadApplicationCommand} from './commands/upload-application'

module.exports = [RunTestsCommand, UploadApplicationCommand, ImportTestsCommand, DeployTestsCommand]
