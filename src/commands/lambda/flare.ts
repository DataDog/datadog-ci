import util from 'util'

import {LambdaClient, LambdaClientConfig} from '@aws-sdk/client-lambda'
import {AwsCredentialIdentity} from '@aws-sdk/types'
import {Command} from 'clipanion'

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
    if (this.functionName === undefined) {
      this.context.stderr.write(renderError('No function name specified. [-f,--function]'))

      return 1
    }

    // Validate region
    if (this.region === undefined && this.functionName.startsWith('arn:aws:lambda')) {
      this.region = this.functionName.split(':')[3]
    }
    this.region = this.region ?? process.env[AWS_DEFAULT_REGION_ENV_VAR]
    if (this.region === undefined) {
      this.context.stderr.write(renderError('No region specified. [-r,--region]'))

      return 1
    }

    // Validate Datadog API key
    this.apiKey = this.apiKey ?? process.env[CI_API_KEY_ENV_VAR] ?? process.env[API_KEY_ENV_VAR]
    if (this.apiKey === undefined) {
      this.context.stderr.write(renderError('No Datadog API key specified. [--api-key]'))

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
    const config = await getLambdaFunctionConfig(lambdaClient, this.functionName)
    const configStr = util.inspect(config, false, undefined, true)
    this.context.stdout.write(configStr)

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
