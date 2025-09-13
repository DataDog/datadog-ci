/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {UploadCommand} from './commands/git-metadata/upload'
import {CheckCommand} from './commands/plugin/check-command'
import {DeployTestsCommand} from './commands/synthetics/deploy-tests-command'
import {ImportTestsCommand} from './commands/synthetics/import-tests-command'
import {RunTestsCommand} from './commands/synthetics/run-tests-command'
import {UploadApplicationCommand} from './commands/synthetics/upload-application-command'

// prettier-ignore
export const commands = {
  'git-metadata': [UploadCommand],
  'plugin': [CheckCommand],
  'synthetics': [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand],
} satisfies RecordWithKebabCaseKeys

/**
 * Some command scopes do not have a plugin package, and their logic is entirely included in `@datadog/datadog-ci-base`.
 */
export const noPluginExceptions: Set<string> = new Set(['git-metadata', 'plugin']) satisfies Set<keyof typeof commands>
