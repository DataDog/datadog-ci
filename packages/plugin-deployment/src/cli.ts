import {DeploymentCorrelateCommand} from './commands/correlate'
import {DeploymentCorrelateImageCommand} from './commands/correlate-image'
import {DeploymentGateCommand} from './commands/gate'
import {DeploymentMarkCommand} from './commands/mark'

module.exports = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
