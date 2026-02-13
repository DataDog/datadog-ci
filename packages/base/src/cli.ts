/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

// DO NOT EDIT MANUALLY. Update the source of truth in `bin/lint-packages.ts` instead.

import {commands as aasCommands} from './commands/aas/cli'
import {commands as cloudRunCommands} from './commands/cloud-run/cli'
import {commands as containerAppCommands} from './commands/container-app/cli'
import {commands as coverageCommands} from './commands/coverage/cli'
import {commands as deploymentCommands} from './commands/deployment/cli'
import {commands as doraCommands} from './commands/dora/cli'
import {commands as dsymsCommands} from './commands/dsyms/cli'
import {commands as elfSymbolsCommands} from './commands/elf-symbols/cli'
import {commands as gateCommands} from './commands/gate/cli'
import {commands as gitMetadataCommands} from './commands/git-metadata/cli'
import {commands as junitCommands} from './commands/junit/cli'
import {commands as lambdaCommands} from './commands/lambda/cli'
import {commands as pluginCommands} from './commands/plugin/cli'
import {commands as sarifCommands} from './commands/sarif/cli'
import {commands as sbomCommands} from './commands/sbom/cli'
import {commands as stepfunctionsCommands} from './commands/stepfunctions/cli'
import {commands as syntheticsCommands} from './commands/synthetics/cli'
import {commands as tagCommands} from './commands/tag/cli'
import {commands as unitySymbolsCommands} from './commands/unity-symbols/cli'

// DO NOT EDIT MANUALLY. Update the source of truth in `bin/lint-packages.ts` instead.

// prettier-ignore
export const commands = {
  'aas': aasCommands,
  'cloud-run': cloudRunCommands,
  'container-app': containerAppCommands,
  'coverage': coverageCommands,
  'deployment': deploymentCommands,
  'dora': doraCommands,
  'dsyms': dsymsCommands,
  'elf-symbols': elfSymbolsCommands,
  'gate': gateCommands,
  'git-metadata': gitMetadataCommands,
  'junit': junitCommands,
  'lambda': lambdaCommands,
  'plugin': pluginCommands,
  'sarif': sarifCommands,
  'sbom': sbomCommands,
  'stepfunctions': stepfunctionsCommands,
  'synthetics': syntheticsCommands,
  'tag': tagCommands,
  'unity-symbols': unitySymbolsCommands,
} satisfies RecordWithKebabCaseKeys

// DO NOT EDIT MANUALLY. Update the source of truth in `bin/lint-packages.ts` instead.

/**
 * Some command scopes do not have a plugin package, and their logic is entirely included in `@datadog/datadog-ci-base`.
 */
export const noPluginExceptions: Set<string> = new Set([
  'dsyms',
  'elf-symbols',
  'git-metadata',
  'plugin',
  'tag',
  'unity-symbols',
]) satisfies Set<keyof typeof commands>
