/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {commands as measureCommands} from './measure/cli'
import {commands as reactNativeCommands} from './react-native/cli'
import {commands as spanCommands} from './span/cli'
import {commands as traceCommands} from './trace/cli'
import {commands as versionCommands} from './version/cli'

// prettier-ignore
export const commands = {
  'measure': measureCommands,
  'react-native': reactNativeCommands,
  'span': spanCommands,
  'trace': traceCommands,
  'version': versionCommands,
} satisfies RecordWithKebabCaseKeys
