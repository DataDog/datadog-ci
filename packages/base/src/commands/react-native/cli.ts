/* eslint-disable import-x/order */
import {ReactNativeCodepushCommand} from './codepush'
import {ReactNativeInjectDebugIdCommand} from './injectDebugId'
import {ReactNativeUploadCommand} from './upload'
import {ReactNativeXcodeCommand} from './xcode'

// prettier-ignore
export const commands = [
  ReactNativeCodepushCommand,
  ReactNativeInjectDebugIdCommand,
  ReactNativeUploadCommand,
  ReactNativeXcodeCommand,
]
