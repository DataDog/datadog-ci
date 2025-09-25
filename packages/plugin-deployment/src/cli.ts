import {PluginCommand as DeploymentCorrelateCommand} from './commands/correlate'
import {PluginCommand as DeploymentCorrelateImageCommand} from './commands/correlate-image'
import {PluginCommand as DeploymentGateCommand} from './commands/gate'
import {PluginCommand as DeploymentMarkCommand} from './commands/mark'

export const commands = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
