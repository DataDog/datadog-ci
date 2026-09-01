/* eslint-disable import-x/order */
import {SourcemapsFindCommand} from './find'
import {SourcemapsInjectCommand} from './inject'
import {SourcemapsUploadCommand} from './upload'

// prettier-ignore
export const commands = [
  SourcemapsFindCommand,
  SourcemapsInjectCommand,
  SourcemapsUploadCommand,
]
