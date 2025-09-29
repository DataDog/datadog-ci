/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {commands as aasCommands} from './commands/aas/cli'
import {commands as cloudRunCommands} from './commands/cloud-run/cli'
import {commands as deploymentCommands} from './commands/deployment/cli'
import {commands as doraCommands} from './commands/dora/cli'
import {commands as gateCommands} from './commands/gate/cli'
import {commands as gitMetadataCommands} from './commands/git-metadata/cli'
import {commands as lambdaCommands} from './commands/lambda/cli'
import {commands as pluginCommands} from './commands/plugin/cli'
import {commands as sarifCommands} from './commands/sarif/cli'
import {commands as sbomCommands} from './commands/sbom/cli'
import {commands as stepfunctionsCommands} from './commands/stepfunctions/cli'
import {commands as syntheticsCommands} from './commands/synthetics/cli'
import {commands as tagCommands} from './commands/tag/cli'

// prettier-ignore
export const commands = {
  'aas': aasCommands,
  'cloud-run': cloudRunCommands,
  'deployment': deploymentCommands,
  'dora': doraCommands,
  'gate': gateCommands,
  'git-metadata': gitMetadataCommands,
  'lambda': lambdaCommands,
  'plugin': pluginCommands,
  'sarif': sarifCommands,
  'sbom': sbomCommands,
  'stepfunctions': stepfunctionsCommands,
  'synthetics': syntheticsCommands,
  'tag': tagCommands,
} satisfies RecordWithKebabCaseKeys

/**
 * Some command scopes do not have a plugin package, and their logic is entirely included in `@datadog/datadog-ci-base`.
 */
export const noPluginExceptions: Set<string> = new Set(['git-metadata', 'plugin', 'tag']) satisfies Set<
  keyof typeof commands
>
