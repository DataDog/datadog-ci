import {PluginCommand as DeploymentCorrelateCommand} from './commands/correlate'
import {PluginCommand as DeploymentCorrelateImageCommand} from './commands/correlate-image'
import {PluginCommand as DeploymentGateCommand} from './commands/gate'
import {PluginCommand as DeploymentMarkCommand} from './commands/mark'

module.exports = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
