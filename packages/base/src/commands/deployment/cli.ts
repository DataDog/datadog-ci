import {DeploymentCorrelateCommand} from './correlate'
import {DeploymentCorrelateImageCommand} from './correlate-image'
import {DeploymentGateCommand} from './gate'
import {DeploymentMarkCommand} from './mark'

// prettier-ignore
export const commands = [
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
  DeploymentMarkCommand,
]
