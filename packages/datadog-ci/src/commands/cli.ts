/* eslint-disable quote-props */
import {CommandClass} from 'clipanion'

import {commands as aasCommands} from './aas/cli'
import {commands as cloudRunCommands} from './cloud-run/cli'
import {commands as coverageCommands} from './coverage/cli'
import {commands as deploymentCommands} from './deployment/cli'
import {commands as doraCommands} from './dora/cli'
import {commands as dsymsCommands} from './dsyms/cli'
import {commands as elfSymbolsCommands} from './elf-symbols/cli'
import {commands as flutterSymbolsCommands} from './flutter-symbols/cli'
import {commands as gateCommands} from './gate/cli'
import {commands as junitCommands} from './junit/cli'
import {commands as lambdaCommands} from './lambda/cli'
import {commands as measureCommands} from './measure/cli'
import {commands as peSymbolsCommands} from './pe-symbols/cli'
import {commands as reactNativeCommands} from './react-native/cli'
import {commands as sarifCommands} from './sarif/cli'
import {commands as sbomCommands} from './sbom/cli'
import {commands as sourcemapsCommands} from './sourcemaps/cli'
import {commands as spanCommands} from './span/cli'
import {commands as stepfunctionsCommands} from './stepfunctions/cli'
import {commands as tagCommands} from './tag/cli'
import {commands as traceCommands} from './trace/cli'
import {commands as unitySymbolsCommands} from './unity-symbols/cli'
import {commands as versionCommands} from './version/cli'

// prettier-ignore
export const commands: Record<string, CommandClass[]> = {
  'aas': aasCommands,
  'cloud-run': cloudRunCommands,
  'coverage': coverageCommands,
  'deployment': deploymentCommands,
  'dora': doraCommands,
  'dsyms': dsymsCommands,
  'elf-symbols': elfSymbolsCommands,
  'flutter-symbols': flutterSymbolsCommands,
  'gate': gateCommands,
  'junit': junitCommands,
  'lambda': lambdaCommands,
  'measure': measureCommands,
  'pe-symbols': peSymbolsCommands,
  'react-native': reactNativeCommands,
  'sarif': sarifCommands,
  'sbom': sbomCommands,
  'sourcemaps': sourcemapsCommands,
  'span': spanCommands,
  'stepfunctions': stepfunctionsCommands,
  'tag': tagCommands,
  'trace': traceCommands,
  'unity-symbols': unitySymbolsCommands,
  'version': versionCommands,
}
