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
import {getAWSCredentials, getLambdaFunctionConfig} from './functions/commons'
import {requestAWSCredentials} from './prompt'
import {renderError, renderLambdaFlareHeader, renderSoftWarning} from './renderers/flare-renderer'

export class LambdaFlareCommand extends Command {
  private isDryRun = false
  private functionName?: string
  private region?: string
  private apiKey?: string
  private caseId?: string
  private email?: string
  private credentials?: AwsCredentialIdentity

  /**
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
    if (
      this.region === undefined &&
      this.functionName !== undefined &&
      this.functionName.startsWith('arn:aws:lambda')
    ) {
      this.region = this.functionName.split(':')[3]
    }
    this.region = this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (this.region === undefined) {
      this.context.stderr.write(renderError('No region specified. [-r,--region]'))
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
    const credentials = await getAWSCredentials()
    if (credentials === undefined) {
      this.context.stdout.write(renderSoftWarning("No AWS credentials found, let's set them up!"))
      await requestAWSCredentials()
    } else {
      this.credentials = credentials
    }

    // Get Lambda function configuration
    this.context.stdout.write('🔍 Getting Lambda function configuration...\n')
    const lambdaClientConfig: LambdaClientConfig = {
      region: this.region,
      credentials: this.credentials,
    }
    const lambdaClient = new LambdaClient(lambdaClientConfig)
    if (this.functionName === undefined) {
      throw new Error('Function name is undefined')
    }
    const config = await getLambdaFunctionConfig(lambdaClient, this.functionName)
    const configStrColored = util.inspect(config, false, undefined, true)
    const configStrUncolored = JSON.stringify(config, undefined, 2)

    // Print config
    this.context.stdout.write(`\n${configStrColored}\n`)
    if (this.isDryRun) {
      this.context.stdout.write('\n🚫 Configuration not sent because the command was ran as a dry run.\n')

      return 0
    }

    // Write config to file
    const folderPath = path.join(process.cwd(), '.lambda-flare-output')
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath)
    }
    const filePath = path.join(folderPath, 'function_config.json')
    fs.writeFileSync(filePath, configStrUncolored)

    // Zip folder
    const zipPath = path.join(folderPath, 'lambda-flare-output.zip')
    const zipFolder = async (command: Command) => {
      try {
        const data = await fs.promises.readFile(filePath, 'utf8')
        const zip = new JSZip()
        zip.file('function_config.json', data)
        const content = await zip.generateAsync({type: 'nodebuffer'})
        await fs.promises.writeFile(zipPath, content)
      } catch (error) {
        command.context.stderr.write(renderError('Error reading file or writing zip file. Please try again.'))

        return true
      }

      return false
    }
    if (await zipFolder(this)) {
      return 1
    }

    // Send to Datadog
    this.context.stdout.write('\n🚀 Sending to Datadog Support...\n')
    const form = new FormData()
    form.append('case_id', this.caseId)
    form.append('flare_file', fs.createReadStream(zipPath))
    form.append('operator_version', 7)
    form.append('email', this.email)
    const requestConfig = {
      headers: {
        ...form.getHeaders(),
        'DD-API-KEY': this.apiKey,
      },
    }
    await axios
      .post('https://datad0g.com/api/ui/support/serverless/flare', form, requestConfig)
      .then(() => {
        this.context.stdout.write('\n✅ Successfully sent function config to Datadog Support!\n')
      })
      .catch((err) => {
        this.context.stderr.write(
          '\n❌ Failed to send function config to Datadog Support. Is your email and case ID correct?\n'
        )
        this.context.stderr.write(renderError(err))
      })

    // Remove file
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
    deleteFolderContents(folderPath)
    try {
      fs.rmdirSync(folderPath)
    } catch (e) {
      this.context.stderr.write(renderSoftWarning('Failed to delete log files located at .lambda-flare-output'))

      return 1
    }

    return 0
  }
}

LambdaFlareCommand.addPath('lambda', 'flare')
LambdaFlareCommand.addOption('isDryRun', Command.Boolean('-d,--dry'))
LambdaFlareCommand.addOption('functionName', Command.String('-f,--function'))
LambdaFlareCommand.addOption('region', Command.String('-r,--region'))
LambdaFlareCommand.addOption('apiKey', Command.String('--api-key'))
LambdaFlareCommand.addOption('caseId', Command.String('-c,--case-id'))
LambdaFlareCommand.addOption('email', Command.String('-e,--email'))
