import {DeploymentCorrelateCommand} from './correlate'
import {DeploymentCorrelateImageCommand} from './correlate-image'
import {DeploymentGateCommand} from './gate'
import {DeploymentMarkCommand} from './mark'

module.exports = [
  DeploymentMarkCommand,
  DeploymentCorrelateCommand,
  DeploymentCorrelateImageCommand,
  DeploymentGateCommand,
]
