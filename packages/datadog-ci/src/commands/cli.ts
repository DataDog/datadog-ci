/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {commands as versionCommands} from './version/cli'

// prettier-ignore
export const commands = {
  'version': versionCommands,
} satisfies RecordWithKebabCaseKeys
