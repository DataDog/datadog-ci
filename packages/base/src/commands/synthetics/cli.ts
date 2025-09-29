import {DeployTestsCommand} from './deploy-tests'
import {ImportTestsCommand} from './import-tests'
import {RunTestsCommand} from './run-tests'
import {UploadApplicationCommand} from './upload-application'

export const commands = [RunTestsCommand, DeployTestsCommand, UploadApplicationCommand, ImportTestsCommand]
