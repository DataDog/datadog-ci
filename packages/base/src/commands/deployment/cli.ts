import {DeploymentCorrelateImageCommand} from './correlate-image'
import {DeploymentCorrelateCommand} from './correlate'
import {DeploymentGateCommand} from './gate'
import {DeploymentMarkCommand} from './mark'

// prettier-ignore
export const commands = [
  DeploymentCorrelateImageCommand,
  DeploymentCorrelateCommand,
  DeploymentGateCommand,
  DeploymentMarkCommand,
]
