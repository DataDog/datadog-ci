import {DeployTestsCommand} from './deploy-tests-command'
import {ImportTestsCommand} from './import-tests-command'
import {RunTestsCommand} from './run-tests-command'
import {UploadApplicationCommand} from './upload-application-command'
import {CassetteServerCommand} from './cassette-server'

module.exports = [RunTestsCommand, UploadApplicationCommand, ImportTestsCommand, DeployTestsCommand, CassetteServerCommand]
