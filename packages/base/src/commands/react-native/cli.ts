import {ReactNativeCodepushCommand} from './codepush'
import {ReactNativeInjectDebugIdCommand} from './injectDebugId'
import {ReactNativeUploadCommand} from './upload'
import {ReactNativeXcodeCommand} from './xcode'

export const commands = [
  ReactNativeCodepushCommand,
  ReactNativeUploadCommand,
  ReactNativeXcodeCommand,
  ReactNativeInjectDebugIdCommand,
]
