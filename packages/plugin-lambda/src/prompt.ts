import {DATADOG_SITES} from '@datadog/datadog-ci-base/constants'
import {
  CI_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  SERVICE_ENV_VAR,
  VERSION_ENV_VAR,
} from '@datadog/datadog-ci-base/helpers/serverless/constants'
import {isValidDatadogSite} from '@datadog/datadog-ci-base/helpers/validation'
import chalk from 'chalk'
import {filter} from 'fuzzy'
import inquirer from 'inquirer'

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

const checkboxPlusPrompt = require('inquirer-checkbox-plus-prompt')
inquirer.registerPrompt('checkbox-plus', checkboxPlusPrompt)

export const awsProfileQuestion = (mfaSerial: string): inquirer.InputQuestion => ({
  default: undefined,
  message: `Enter MFA code for ${mfaSerial}: `,
  name: 'AWS_MFA',
  type: 'input',
  validate: (value) => {
    if (!value || value === undefined || value.length < 6) {
      return 'Enter a valid MFA token. Length must be greater than or equal to 6.'
    }

    return true
  },
})

const awsCredentialsQuestions: inquirer.QuestionCollection = [
  {
    // AWS_ACCESS_KEY_ID question
    message: 'Enter AWS Access Key ID:',
    name: AWS_ACCESS_KEY_ID_ENV_VAR,
    type: 'input',
    validate: (value) => {
      if (!value || !sentenceMatchesRegEx(value, AWS_ACCESS_KEY_ID_REG_EXP)) {
        return 'Enter a valid AWS Access Key ID.'
      }

      return true
    },
  },
  {
    // AWS_SECRET_ACCESS_KEY_ENV_VAR question
    mask: true,
    message: 'Enter AWS Secret Access Key:',
    name: AWS_SECRET_ACCESS_KEY_ENV_VAR,
    type: 'password',
    validate: (value) => {
      if (!value || !sentenceMatchesRegEx(value, AWS_SECRET_ACCESS_KEY_REG_EXP)) {
        return 'Enter a valid AWS Secret Access Key.'
      }

      return true
    },
  },
  {
    // AWS_SESSION_TOKEN
    mask: true,
    message: 'Enter AWS Session Token (optional):',
    name: AWS_SESSION_TOKEN_ENV_VAR,
    type: 'password',
  },
]

const awsRegionQuestion = (defaultRegion?: string): inquirer.InputQuestion => ({
  default: defaultRegion,
  message: 'Which AWS region (e.g., us-east-1) your Lambda functions are deployed?',
  name: AWS_DEFAULT_REGION_ENV_VAR,
  type: 'input',
})

export const datadogApiKeyTypeQuestion = (datadogSite: string): inquirer.ListQuestion => ({
  choices: [
    {
      name: `Plain text ${chalk.bold('API Key')} (Recommended for trial users) `,
      value: {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      },
    },
    new inquirer.Separator(),
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
  name: 'type',
  type: 'list',
})

const datadogSiteQuestion: inquirer.ListQuestion = {
  // DATADOG SITE
  choices: DATADOG_SITES,
  message: `Select the Datadog site to send data. \nLearn more at ${chalk.blueBright(
    'https://docs.datadoghq.com/getting_started/site/'
  )}`,
  name: CI_SITE_ENV_VAR,
  type: 'list',
}

const envQuestion: inquirer.InputQuestion = {
  default: undefined,
  message: 'Enter a value for the environment variable DD_ENV',
  suffix: chalk.dim(' (recommended)'),
  name: ENVIRONMENT_ENV_VAR,
  type: 'input',
}

const serviceQuestion: inquirer.InputQuestion = {
  default: undefined,
  message: 'Enter a value for the environment variable DD_SERVICE',
  suffix: chalk.dim(' (recommended)'),
  name: SERVICE_ENV_VAR,
  type: 'input',
}

const versionQuestion: inquirer.InputQuestion = {
  default: undefined,
  message: 'Enter a value for the environment variable DD_VERSION',
  suffix: chalk.dim(' (recommended)'),
  name: VERSION_ENV_VAR,
  type: 'input',
}

const INVALID_KEY_MESSAGE = 'Enter a valid Datadog API Key.'

export const datadogEnvVarsQuestions = (datadogApiKeyType: Record<string, any>): inquirer.InputQuestion => ({
  // DATADOG API KEY given type
  default: process.env[datadogApiKeyType.envVar],
  message: datadogApiKeyType.message,
  name: datadogApiKeyType.envVar,
  type: 'input',
  validate: (value) => {
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

export const functionSelectionQuestion = (functionNames: string[]): typeof checkboxPlusPrompt => ({
  choices: functionNames,
  highlight: true,
  message:
    'Select the functions to modify (Press <space> to select, p.s. start typing the name instead of manually scrolling)',
  name: 'functions',
  pageSize: 10,
  searchable: true,
  source: (answersSoFar: unknown, input: string) => {
    input = input || ''

    return new Promise((resolve) => {
      const fuzzyResult = filter(input, functionNames)
      const data = fuzzyResult.map((element) => element.original)
      resolve(data)
    })
  },
  type: 'checkbox-plus',
  validate: (selectedFunctions: string | string[]) => {
    if (selectedFunctions.length < 1) {
      return 'You must choose at least one function.'
    }

    return true
  },
})

export const requestAWSCredentials = async (): Promise<void> => {
  try {
    const awsCredentialsAnswers = await inquirer.prompt(awsCredentialsQuestions)
    process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = awsCredentialsAnswers[AWS_ACCESS_KEY_ID_ENV_VAR]
    process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = awsCredentialsAnswers[AWS_SECRET_ACCESS_KEY_ENV_VAR]
    if (awsCredentialsAnswers[AWS_SESSION_TOKEN_ENV_VAR] !== undefined) {
      process.env[AWS_SESSION_TOKEN_ENV_VAR] = awsCredentialsAnswers[AWS_SESSION_TOKEN_ENV_VAR]
    }
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set AWS Credentials. ${e.message}`)
    }
  }
}

export const requestAWSRegion = async (defaultRegion?: string): Promise<void> => {
  try {
    const awsRegionAnswer = await inquirer.prompt(awsRegionQuestion(defaultRegion))
    process.env[AWS_DEFAULT_REGION_ENV_VAR] = awsRegionAnswer[AWS_DEFAULT_REGION_ENV_VAR]
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
      const datadogSiteAnswer = await inquirer.prompt(datadogSiteQuestion)
      selectedDatadogSite = datadogSiteAnswer[CI_SITE_ENV_VAR]
      process.env[CI_SITE_ENV_VAR] = selectedDatadogSite
    }

    if (isMissingAnyDatadogApiKeyEnvVar()) {
      const datadogApiKeyTypeAnswer = await inquirer.prompt(datadogApiKeyTypeQuestion(selectedDatadogSite!))
      const datadogApiKeyType = datadogApiKeyTypeAnswer.type
      const datadogEnvVars = await inquirer.prompt(datadogEnvVarsQuestions(datadogApiKeyType))
      const selectedDatadogApiKeyEnvVar = datadogApiKeyType.envVar
      process.env[selectedDatadogApiKeyEnvVar] = datadogEnvVars[selectedDatadogApiKeyEnvVar]
    }
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set Datadog Environment Variables. ${e.message}`)
    }
  }
}

export const requestEnvServiceVersion = async (): Promise<void> => {
  try {
    const envQuestionAnswer = await inquirer.prompt(envQuestion)
    const inputedEnvQuestionAnswer = envQuestionAnswer[ENVIRONMENT_ENV_VAR]
    process.env[ENVIRONMENT_ENV_VAR] = inputedEnvQuestionAnswer

    const serviceQuestionAnswer = await inquirer.prompt(serviceQuestion)
    const inputedServiceQuestionAnswer = serviceQuestionAnswer[SERVICE_ENV_VAR]
    process.env[SERVICE_ENV_VAR] = inputedServiceQuestionAnswer

    const versionQuestionAnswer = await inquirer.prompt(versionQuestion)
    const inputedVersionQuestionAnswer = versionQuestionAnswer[VERSION_ENV_VAR]
    process.env[VERSION_ENV_VAR] = inputedVersionQuestionAnswer
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set user defined env, service, and version environment variables. ${e.message}`)
    }
  }
}

export const requestFunctionSelection = async (functionNames: string[]): Promise<any> => {
  try {
    const selectedFunctionsAnswer: any = await inquirer.prompt(functionSelectionQuestion(functionNames))

    return selectedFunctionsAnswer.functions
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't receive selected functions. ${e.message}`)
    }
  }
}
