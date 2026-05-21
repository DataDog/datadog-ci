import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import {
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import {checkbox, input, password, select} from '@inquirer/prompts'
import chalk from 'chalk'

import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_ACCESS_KEY_ID_REG_EXP,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_REG_EXP,
  AWS_SECRET_ARN_REG_EXP,
  AWS_SESSION_TOKEN_ENV_VAR,
  AWS_SSM_ARN_REG_EXP,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_API_KEY_SSM_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  DATADOG_API_KEY_REG_EXP,
} from './constants'
import {isMissingAnyDatadogApiKeyEnvVar, sentenceMatchesRegEx} from './functions/commons'

type DatadogApiKeyType = {
  envVar: string
  message: string
}

export const awsProfileQuestion = (mfaSerial: string) => ({
  default: undefined,
  message: `Enter MFA code for ${mfaSerial}: `,
  validate: (value: string) => {
    if (!value || value.length < 6) {
      return 'Enter a valid MFA token. Length must be greater than or equal to 6.'
    }

    return true
  },
})

const awsAccessKeyIdQuestion = {
  message: 'Enter AWS Access Key ID:',
  validate: (value: string) => {
    if (!value || !sentenceMatchesRegEx(value, AWS_ACCESS_KEY_ID_REG_EXP)) {
      return 'Enter a valid AWS Access Key ID.'
    }

    return true
  },
}

const awsSecretAccessKeyQuestion = {
  mask: true,
  message: 'Enter AWS Secret Access Key:',
  validate: (value: string) => {
    if (!value || !sentenceMatchesRegEx(value, AWS_SECRET_ACCESS_KEY_REG_EXP)) {
      return 'Enter a valid AWS Secret Access Key.'
    }

    return true
  },
}

const awsSessionTokenQuestion = {
  mask: true,
  message: 'Enter AWS Session Token (optional):',
}

const awsRegionQuestion = (defaultRegion?: string) => ({
  default: defaultRegion,
  message: 'Which AWS region (e.g., us-east-1) your Lambda functions are deployed?',
})

export const datadogApiKeyTypeQuestion = (datadogSite: string) => ({
  choices: [
    {
      name: `Plain text ${chalk.bold('API Key')} (Recommended for trial users) `,
      value: {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      },
    },
    {
      name: `API key encrypted with AWS Key Management Service ${chalk.bold('(KMS) API Key')}`,
      value: {
        envVar: CI_KMS_API_KEY_ENV_VAR,
        message: 'KMS Encrypted API Key:',
      },
    },
    {
      name: `AWS Secrets Manager ${chalk.bold('API Key Secret ARN')}`,
      value: {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      },
    },
    {
      name: `AWS Systems Manager Parameter Store ${chalk.bold('API Key SSM ARN')}`,
      value: {
        envVar: CI_API_KEY_SSM_ARN_ENV_VAR,
        message: 'API Key SSM Parameter ARN:',
      },
    },
  ],
  message: `Which type of Datadog API Key you want to set? \nLearn more at ${chalk.blueBright(
    `https://app.${datadogSite}/organization-settings/api-keys`
  )}`,
})

const datadogSiteQuestion = {
  choices: DATADOG_SITES,
  message: `Select the Datadog site to send data. \nLearn more at ${chalk.blueBright(
    'https://docs.datadoghq.com/getting_started/site/'
  )}`,
}

const envQuestion = {
  default: undefined,
  message: `Enter a value for the environment variable DD_ENV${chalk.dim(' (recommended)')}`,
}

const serviceQuestion = {
  default: undefined,
  message: `Enter a value for the environment variable DD_SERVICE${chalk.dim(' (recommended)')}`,
}

const versionQuestion = {
  default: undefined,
  message: `Enter a value for the environment variable DD_VERSION${chalk.dim(' (recommended)')}`,
}

const INVALID_KEY_MESSAGE = 'Enter a valid Datadog API Key.'

export const datadogEnvVarsQuestions = (datadogApiKeyType: DatadogApiKeyType) => ({
  default: process.env[datadogApiKeyType.envVar],
  message: datadogApiKeyType.message,
  validate: (value: string) => {
    if (!value) {
      return INVALID_KEY_MESSAGE
    }

    if (datadogApiKeyType.envVar === CI_API_KEY_ENV_VAR && !sentenceMatchesRegEx(value, DATADOG_API_KEY_REG_EXP)) {
      return INVALID_KEY_MESSAGE
    }

    if (
      datadogApiKeyType.envVar === CI_API_KEY_SECRET_ARN_ENV_VAR &&
      !sentenceMatchesRegEx(value, AWS_SECRET_ARN_REG_EXP)
    ) {
      return INVALID_KEY_MESSAGE
    }

    if (datadogApiKeyType.envVar === CI_API_KEY_SSM_ARN_ENV_VAR && !sentenceMatchesRegEx(value, AWS_SSM_ARN_REG_EXP)) {
      return INVALID_KEY_MESSAGE
    }

    return true
  },
})

export const functionSelectionQuestion = (functionNames: string[]) => ({
  choices: functionNames,
  message: 'Select the functions to modify.',
  pageSize: 10,
  validate: (selected: readonly unknown[]) => {
    if (selected.length < 1) {
      return 'You must choose at least one function.'
    }

    return true
  },
})

export const requestAWSCredentials = async (): Promise<void> => {
  try {
    process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = await input(awsAccessKeyIdQuestion)
    process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = await password(awsSecretAccessKeyQuestion)

    const awsSessionToken = await password(awsSessionTokenQuestion)
    if (awsSessionToken !== undefined) {
      process.env[AWS_SESSION_TOKEN_ENV_VAR] = awsSessionToken
    }
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set AWS Credentials. ${e.message}`)
    }
  }
}

export const requestAWSRegion = async (defaultRegion?: string): Promise<void> => {
  try {
    process.env[AWS_DEFAULT_REGION_ENV_VAR] = await input(awsRegionQuestion(defaultRegion))
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set AWS region. ${e.message}`)
    }
  }
}

export const requestDatadogEnvVars = async (): Promise<void> => {
  try {
    const envSite = process.env[CI_SITE_ENV_VAR]
    let selectedDatadogSite = envSite
    if (!isValidDatadogSite(envSite)) {
      selectedDatadogSite = await select(datadogSiteQuestion)
      process.env[CI_SITE_ENV_VAR] = selectedDatadogSite
    }

    if (isMissingAnyDatadogApiKeyEnvVar()) {
      const datadogApiKeyType = await select(datadogApiKeyTypeQuestion(selectedDatadogSite!))
      const datadogEnvVar = await input(datadogEnvVarsQuestions(datadogApiKeyType))
      process.env[datadogApiKeyType.envVar] = datadogEnvVar
    }
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set Datadog Environment Variables. ${e.message}`)
    }
  }
}

export const requestEnvServiceVersion = async (): Promise<void> => {
  try {
    process.env[ENVIRONMENT_ENV_VAR] = await input(envQuestion)
    process.env[SERVICE_ENV_VAR] = await input(serviceQuestion)
    process.env[VERSION_ENV_VAR] = await input(versionQuestion)
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set user defined env, service, and version environment variables. ${e.message}`)
    }
  }
}

export const requestFunctionSelection = async (functionNames: string[]): Promise<string[]> => {
  try {
    return await checkbox(functionSelectionQuestion(functionNames))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)

    throw Error(`Couldn't receive selected functions. ${message}`)
  }
}
