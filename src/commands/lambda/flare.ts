import * as fs from 'fs'
import * as path from 'path'
import util from 'util'

import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import axios from 'axios'
import {Command} from 'clipanion'
import FormData from 'form-data'
import JSZip from 'jszip'

import {API_KEY_ENV_VAR, AWS_DEFAULT_REGION_ENV_VAR, CI_API_KEY_ENV_VAR} from './constants'
import {getAWSCredentials, getLambdaFunctionConfig, getRegion} from './functions/commons'
import {requestAWSCredentials} from './prompt'
import {
  renderError,
  renderNoAWSCredentialsFound,
  renderNoDefaultRegionSpecifiedError,
  renderSoftWarning,
} from './renderers/common-renderer'
import {renderLambdaFlareHeader} from './renderers/flare-renderer'

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private functionName?: string
  private region?: string
  private apiKey?: string
  private caseId?: string
  private email?: string
  private credentials?: AwsCredentialIdentity

  /**
   * Entry point for the `lambda flare` command.
   * Gathers lambda function configuration and sends it to Datadog.
   * @returns 0 if the command ran successfully, 1 otherwise.
   */
  public async execute() {
    this.context.stdout.write(renderLambdaFlareHeader(this.isDryRun))

    // Validate function name
    let errorFound = false
    if (this.functionName === undefined) {
      this.context.stderr.write(renderError('No function name specified. [-f,--function]'))
      errorFound = true
    }

    // Validate region
    this.region = this.region ?? getRegion(this.functionName ?? '')
    this.region = this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (this.region === undefined) {
      this.context.stderr.write(renderNoDefaultRegionSpecifiedError())
      errorFound = true
    }

    // Validate Datadog API key
    this.apiKey = this.apiKey ?? process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      this.context.stderr.write(renderError('No Datadog API key specified. [--api-key]'))
      errorFound = true
    }

    // Validate case ID
    if (this.caseId === undefined) {
      this.context.stderr.write(renderError('No case ID specified. [-c,--case-id]'))
      errorFound = true
    }

    // Validate email
    if (this.email === undefined) {
      this.context.stderr.write(renderError('No email specified. [-e,--email]'))
      errorFound = true
    }

    if (errorFound) {
      return 1
    }

    // Get AWS credentials
    this.context.stdout.write('\n🔑 Getting AWS credentials...\n')
    let credentials
    try {
      credentials = await getAWSCredentials()
    } catch (err) {
      this.context.stderr.write(renderError(err))

      return 1
    }
    if (credentials === undefined) {
      this.context.stdout.write(renderNoAWSCredentialsFound())
      try {
        await requestAWSCredentials()
      } catch (err) {
        this.context.stderr.write(renderError(err))

        return 1
      }
    } else {
      this.credentials = credentials
    }

    // Get Lambda function configuration
    if (this.functionName === undefined) {
      this.context.stderr.write(renderError('Function name is undefined.'))

      return 1
    }
    this.context.stdout.write('🔍 Getting Lambda function configuration...\n')
    const lambdaClientConfig: LambdaClientConfig = {
      region: this.region,
      credentials: this.credentials,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    let config
    try {
      config = await getLambdaFunctionConfig(lambdaClient, this.functionName ?? '')
    } catch (err) {
      this.context.stderr.write(renderError(`Unable to get Lambda function configuration: ${err}`))

      return 1
    }
    const configStrColored = util.inspect(config, false, undefined, true)
    const configStrUncolored = JSON.stringify(config, undefined, 2)

    // Print config
    this.context.stdout.write(`\n${configStrColored}\n`)
    if (this.isDryRun) {
      this.context.stdout.write('\n🚫 The configuration was not sent as it was executed in dry run mode.\n')

      return 0
    }

    // Write config to file
    const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
    const folderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
    if (!fs.existsSync(folderPath)) {
      try {
        fs.mkdirSync(folderPath)
      } catch (err) {
        this.context.stderr.write(renderError(`Unable to create flare folder: ${err}`))

        return 1
      }
    }
    const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
    const filePath = path.join(folderPath, FUNCTION_CONFIG_FILE_NAME)
    try {
      fs.writeFileSync(filePath, configStrUncolored)
    } catch (err) {
      this.context.stderr.write(renderError(`Unable to write the flare output file: ${err}`))

      return 1
    }

    // Zip folder
    const zipPath = path.join(folderPath, 'lambda-flare-output.zip')
    try {
      const data = await fs.promises.readFile(filePath, 'utf8')
      const zip = new JSZip()
      zip.file(FUNCTION_CONFIG_FILE_NAME, data)
      const content = await zip.generateAsync({type: 'nodebuffer'})
      await fs.promises.writeFile(zipPath, content)
    } catch (err) {
      this.context.stderr.write(renderError(`Unable to zip the flare file: ${err}`))

      return 1
    }

    // Send to Datadog
    this.context.stdout.write('\n🚀 Sending to Datadog Support...\n')
    const form = new FormData()
    form.append('case_id', this.caseId)
    try {
      form.append('flare_file', fs.createReadStream(zipPath))
    } catch (err) {
      this.context.stderr.write(renderError(`Unable to read the flare file: ${err}`))

      return 1
    }
    form.append('operator_version', 7)
    form.append('email', this.email)
    const headerConfig = {
      headers: {
        ...form.getHeaders(),
        'DD-API-KEY': this.apiKey,
      },
    }
    const ENDPOINT_URL = 'https://datad0g.com/api/ui/support/serverless/flare'
    try {
      await axios.post(ENDPOINT_URL, form, headerConfig).then(() => {
        this.context.stdout.write('\n✅ Successfully sent function config to Datadog Support!\n')
      })
    } catch (err) {
      this.context.stderr.write(renderError(`Failed to send function config to Datadog Support: ${err}`))
    }

    // Remove file
    try {
      deleteFolderContents(folderPath)
      fs.rmdirSync(folderPath)
    } catch (err) {
      this.context.stderr.write(renderSoftWarning(`Failed to delete flare files located at ${folderPath}: ${err}`))

      return 1
    }

    return 0
  }
}

const deleteFolderContents = (dir: string) => {
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).forEach((file) => {
      const currentPath = path.join(dir, file)
      if (fs.lstatSync(currentPath).isDirectory()) {
        deleteFolderContents(currentPath)
      } else {
        fs.unlinkSync(currentPath)
      }
    })
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('apiKey', Command.String('--api-key'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
