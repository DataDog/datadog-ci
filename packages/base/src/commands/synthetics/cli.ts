import {SyntheticsDeployTestsCommand} from './deploy-tests'
import {SyntheticsImportTestsCommand} from './import-tests'
import {SyntheticsRunTestsCommand} from './run-tests'
import {SyntheticsUploadApplicationCommand} from './upload-application'

// prettier-ignore
export const commands = [
  SyntheticsDeployTestsCommand,
  SyntheticsImportTestsCommand,
  SyntheticsRunTestsCommand,
  SyntheticsUploadApplicationCommand,
]
