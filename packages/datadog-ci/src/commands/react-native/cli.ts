import {CodepushCommand} from './codepush'
import {InjectDebugIdCommand} from './injectDebugId'
import {UploadCommand} from './upload'
import {XCodeCommand} from './xcode'

export const commands = [CodepushCommand, UploadCommand, XCodeCommand, InjectDebugIdCommand]
