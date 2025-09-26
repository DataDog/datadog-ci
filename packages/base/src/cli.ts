/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {InstrumentCommand as AasInstrumentCommand} from './commands/aas/instrument'
import {UninstrumentCommand as AasUninstrumentCommand} from './commands/aas/uninstrument'
import {CloudRunFlareCommand} from './commands/cloud-run/flare'
import {InstrumentCommand as CloudRunInstrumentCommand} from './commands/cloud-run/instrument'
import {UninstrumentCommand as CloudRunUninstrumentCommand} from './commands/cloud-run/uninstrument'
import {DeploymentCorrelateCommand} from './commands/deployment/correlate-command'
import {DeploymentCorrelateImageCommand} from './commands/deployment/correlate-image-command'
import {DeploymentGateCommand} from './commands/deployment/gate-command'
import {DeploymentMarkCommand} from './commands/deployment/mark-command'
import {DORADeploymentCommand} from './commands/dora/deployment-command'
import {GateEvaluateCommand} from './commands/gate/evaluate-command'
import {UploadCommand} from './commands/git-metadata/upload'
import {LambdaFlareCommand} from './commands/lambda/flare'
import {InstrumentCommand as LambdaInstrumentCommand} from './commands/lambda/instrument'
import {UninstrumentCommand as LambdaUninstrumentCommand} from './commands/lambda/uninstrument'
import {CheckCommand} from './commands/plugin/check-command'
import {SarifUploadCommand} from './commands/sarif/upload-command'
import {SbomUploadCommand} from './commands/sbom/upload-command'
import {InstrumentStepFunctionsCommand} from './commands/stepfunctions/instrument'
import {UninstrumentStepFunctionsCommand} from './commands/stepfunctions/uninstrument'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'
import {TagCommand} from './commands/tag/tag-command'

// prettier-ignore
export const commands = {
  'aas': [AasInstrumentCommand, AasUninstrumentCommand],
  'cloud-run': [CloudRunInstrumentCommand, CloudRunUninstrumentCommand, CloudRunFlareCommand],
  'deployment': [DeploymentMarkCommand, DeploymentCorrelateCommand, DeploymentCorrelateImageCommand, DeploymentGateCommand],
  'dora': [DORADeploymentCommand],
  'gate': [GateEvaluateCommand],
  'git-metadata': [UploadCommand],
  'lambda': [LambdaInstrumentCommand, LambdaUninstrumentCommand, LambdaFlareCommand],
  'plugin': [CheckCommand],
  'sarif': [SarifUploadCommand],
  'sbom': [SbomUploadCommand],
  'stepfunctions': [InstrumentStepFunctionsCommand, UninstrumentStepFunctionsCommand],
  'synthetics': [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
  'tag': [TagCommand],
} satisfies RecordWithKebabCaseKeys

/**
 * Some command scopes do not have a plugin package, and their logic is entirely included in `@datadog/datadog-ci-base`.
 */
export const noPluginExceptions: Set<string> = new Set(['git-metadata', 'plugin', 'tag']) satisfies Set<
  keyof typeof commands
>
