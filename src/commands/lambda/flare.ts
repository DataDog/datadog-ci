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
import * as commonRenderer from './renderers/common-renderer'
import * as flareRenderer from './renderers/flare-renderer'

const ENDPOINT_URL = 'https://datad0g.com/api/ui/support/serverless/flare'
const FLARE_OUTPUT_DIRECTORY = '.datadog-ci'
const FUNCTION_CONFIG_FILE_NAME = 'function_config.json'
const ZIP_FILE_NAME = 'lambda-flare-output.zip'

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
    this.context.stdout.write(flareRenderer.renderLambdaFlareHeader(this.isDryRun))

    // Validate function name
    if (this.functionName === undefined) {
      this.context.stderr.write(commonRenderer.renderError('No function name specified. [-f,--function]'))

      return 1
    }

    // Validate region
    let errorFound = false
    const region = getRegion(this.functionName) ?? this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (region === undefined) {
      this.context.stderr.write(commonRenderer.renderNoDefaultRegionSpecifiedError())
      errorFound = true
    }

    // Validate Datadog API key
    this.apiKey = process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      this.context.stderr.write(
        commonRenderer.renderError(
          'No Datadog API key specified. Set an API key with the DATADOG_API_KEY environment variable.'
        )
      )
      errorFound = true
    }

    // Validate case ID
    if (this.caseId === undefined) {
      this.context.stderr.write(commonRenderer.renderError('No case ID specified. [-c,--case-id]'))
      errorFound = true
    }

    // Validate email
    if (this.email === undefined) {
      this.context.stderr.write(commonRenderer.renderError('No email specified. [-e,--email]'))
      errorFound = true
    }

    if (errorFound) {
      return 1
    }

    // Get AWS credentials
    this.context.stdout.write('\n🔑 Getting AWS credentials...\n')
    try {
      this.credentials = await getAWSCredentials()
    } catch (err) {
      this.context.stderr.write(commonRenderer.renderError(err))

      return 1
    }
    if (this.credentials === undefined) {
      this.context.stdout.write(commonRenderer.renderNoAWSCredentialsFound())
      try {
        await requestAWSCredentials()
      } catch (err) {
        this.context.stderr.write(commonRenderer.renderError(err))

        return 1
      }
    }

    // Get Lambda function configuration
    this.context.stdout.write('\n🔍 Getting Lambda function configuration...\n')
    const lambdaClientConfig: LambdaClientConfig = {
      region,
      credentials: this.credentials,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    let config
    try {
      config = await getLambdaFunctionConfig(lambdaClient, this.functionName ?? '')
    } catch (err) {
      this.context.stderr.write(
        commonRenderer.renderError(`Unable to get Lambda function configuration: ${err.message}`)
      )

      return 1
    }

    // Print config
    const configStrColored = util.inspect(config, false, undefined, true)
    this.context.stdout.write(`\n${configStrColored}\n`)
    if (this.isDryRun) {
      this.context.stdout.write('\n🚫 The configuration was not sent as it was executed in dry run mode.\n')

      return 0
    }

    // Send data to Datadog
    const folderPath = path.join(process.cwd(), FLARE_OUTPUT_DIRECTORY)
    const filePath = path.join(folderPath, FUNCTION_CONFIG_FILE_NAME)
    const zipPath = path.join(folderPath, ZIP_FILE_NAME)
    const configStrUncolored = JSON.stringify(config, undefined, 2)
    try {
      await this.writeFile(folderPath, filePath, configStrUncolored)
      await this.zipContents(filePath, zipPath)
      this.context.stdout.write('\n🚀 Sending to Datadog Support...\n')
      await this.sendToDatadog(zipPath)
      this.deleteFolder(folderPath)
    } catch (err) {
      this.context.stderr.write(commonRenderer.renderError(err.message))

      return 1
    }

    return 0
  }

  /**
   * Write the function config to a file
   * @param folderPath
   * @param filePath
   * @param data
   * @throws Error if the file cannot be written
   */
  private writeFile = async (folderPath: string, filePath: string, data: string) => {
    if (fs.existsSync(filePath)) {
      this.deleteFolder(folderPath)
    }

    try {
      fs.mkdirSync(folderPath)
      fs.writeFileSync(filePath, data)
    } catch (err) {
      throw Error(`Unable to save function config: ${err.message}`)
    }
  }

  /**
   * Zip the contents of the flare folder
   * @param filePath
   * @param zipPath
   * @throws Error if the zip fails
   */
  private zipContents = async (filePath: string, zipPath: string) => {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8')
      const zip = new JSZip()
      zip.file(FUNCTION_CONFIG_FILE_NAME, data)
      const content = await zip.generateAsync({type: 'nodebuffer'})
      await fs.promises.writeFile(zipPath, content)
    } catch (err) {
      throw Error(`Unable to zip the flare file: ${err.message}`)
    }
  }

  /**
   * Send the zip file to Datadog support
   * @param zipPath
   * @throws Error if the request fails
   */
  private sendToDatadog = async (zipPath: string) => {
    const form = new FormData()
    form.append('case_id', this.caseId)
    form.append('flare_file', fs.createReadStream(zipPath))
    form.append('operator_version', 7)
    form.append('email', this.email)
    const headerConfig = {
      headers: {
        ...form.getHeaders(),
        'DD-API-KEY': this.apiKey,
      },
    }

    try {
      await axios.post(ENDPOINT_URL, form, headerConfig)
      this.context.stdout.write('\n✅ Successfully sent function config to Datadog Support!\n')
    } catch (err) {
      const errResponse: string = err.response?.data?.error
      throw Error(`Failed to send function config to Datadog Support: ${err.message}. ${errResponse ?? ''}\n`)
    }
  }

  /**
   * Delete a folder and all its contents
   * @param folderPath the folder to delete
   * @throws Error if the deletion fails
   */
  private deleteFolder = (folderPath: string) => {
    try {
      fs.rmSync(folderPath, {recursive: true, force: true})
    } catch (err) {
      this.context.stdout.write(
        commonRenderer.renderSoftWarning(`Failed to delete files located at ${folderPath}: ${err.message}`)
      )
    }
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
