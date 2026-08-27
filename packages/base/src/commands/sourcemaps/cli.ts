/* eslint-disable import-x/order */
import {SourcemapsInjectCommand} from './inject'
import {SourcemapsResolveCommand} from './resolve'
import {SourcemapsUploadCommand} from './upload'

// prettier-ignore
export const commands = [
  SourcemapsInjectCommand,
  SourcemapsResolveCommand,
  SourcemapsUploadCommand,
]
