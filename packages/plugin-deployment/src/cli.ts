import {DeploymentCorrelateCommand} from './commands/correlate'
import {DeploymentCorrelateImageCommand} from './commands/correlate-image'
import {DeploymentGateCommand} from './commands/gate'
import {DeploymentMarkCommand} from './commands/mark'

export const commands = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
