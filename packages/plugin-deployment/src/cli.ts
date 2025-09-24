import {DeploymentCorrelateCommand} from './correlate'
import {DeploymentCorrelateImageCommand} from './correlate-image'
import {DeploymentGateCommand} from './gate'
import {DeploymentMarkCommand} from './mark'

export const commands = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
