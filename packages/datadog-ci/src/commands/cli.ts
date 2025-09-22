/* eslint-disable quote-props */
import type {RecordWithKebabCaseKeys} from '@datadog/datadog-ci-base/helpers/types'

import {commands as coverageCommands} from './coverage/cli'
import {commands as deploymentCommands} from './deployment/cli'
import {commands as dsymsCommands} from './dsyms/cli'
import {commands as elfSymbolsCommands} from './elf-symbols/cli'
import {commands as flutterSymbolsCommands} from './flutter-symbols/cli'
import {commands as gateCommands} from './gate/cli'
import {commands as junitCommands} from './junit/cli'
import {commands as measureCommands} from './measure/cli'
import {commands as peSymbolsCommands} from './pe-symbols/cli'
import {commands as reactNativeCommands} from './react-native/cli'
import {commands as sourcemapsCommands} from './sourcemaps/cli'
import {commands as spanCommands} from './span/cli'
import {commands as traceCommands} from './trace/cli'
import {commands as unitySymbolsCommands} from './unity-symbols/cli'
import {commands as versionCommands} from './version/cli'

// prettier-ignore
export const commands = {
  'coverage': coverageCommands,
  'deployment': deploymentCommands,
  'dsyms': dsymsCommands,
  'elf-symbols': elfSymbolsCommands,
  'flutter-symbols': flutterSymbolsCommands,
  'gate': gateCommands,
  'junit': junitCommands,
  'measure': measureCommands,
  'pe-symbols': peSymbolsCommands,
  'react-native': reactNativeCommands,
  'sourcemaps': sourcemapsCommands,
  'span': spanCommands,
  'trace': traceCommands,
  'unity-symbols': unitySymbolsCommands,
  'version': versionCommands,
} satisfies RecordWithKebabCaseKeys
