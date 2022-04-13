import {blueBright, bold} from 'chalk'
import {
  CheckboxQuestion,
  ConfirmQuestion,
  InputQuestion,
  ListQuestion,
  prompt,
  QuestionCollection,
  Separator,
} from 'inquirer'
import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_ACCESS_KEY_ID_REG_EXP,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_REG_EXP,
  AWS_SESSION_TOKEN_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
  DATADOG_API_KEY_REG_EXP,
  ENV_TAG,
  SERVICE_TAG,
  VERSION_TAG,
  SITES,
} from './constants'
import {sentenceMatchesRegEx} from './functions/commons'

const awsCredentialsQuestions: QuestionCollection = [
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

const awsRegionQuestion = (defaultRegion?: string): InputQuestion => ({
  default: defaultRegion,
  message: 'Which AWS region (e.g., us-east-1) your Lambda functions are deployed?',
  name: AWS_DEFAULT_REGION_ENV_VAR,
  type: 'input',
})

export const datadogApiKeyTypeQuestion = (datadogSite: string): ListQuestion => ({
  choices: [
    {
      name: `Plain text ${bold('API Key')} (Recommended for trial users) `,
      value: {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      },
    },
    new Separator(),
    {
      name: `API key encrypted with AWS Key Management Service ${bold('(KMS) API Key')}`,
      value: {
        envVar: CI_KMS_API_KEY_ENV_VAR,
        message: 'KMS Encrypted API Key:',
      },
    },
    {
      name: `AWS Secrets Manager ${bold('API Key Secret ARN')}`,
      value: {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      },
    },
  ],
  message: `Which type of Datadog API Key you want to set? \nLearn more at ${blueBright(
    `https://app.${datadogSite}/organization-settings/api-keys`
  )}`,
  name: 'type',
  type: 'list',
})

const datadogSiteQuestion: ListQuestion = {
  // DATADOG SITE
  choices: SITES,
  message: `Select the Datadog site to send data. \nLearn more at ${blueBright(
    'https://docs.datadoghq.com/getting_started/site/'
  )}`,
  name: CI_SITE_ENV_VAR,
  type: 'list',
}

const envTagQuestion: InputQuestion = {
  default: "",
  message: 'Enter a value for environment (DD_ENV)',
  name: ENV_TAG,
  type: 'input'
}

const serviceTagQuestion: InputQuestion = {
  default: "",
  message: 'Enter a value for service (DD_SERVICE)',
  name: SERVICE_TAG,
  type: 'input'
}

const versionTagQuestion: InputQuestion = {
  default: "",
  message: 'Enter a value for the version (DD_VERISON)',
  name: VERSION_TAG,
  type: 'input',
}

export const datadogEnvVarsQuestions = (datadogApiKeyType: Record<string, any>): InputQuestion => ({
  // DATADOG API KEY given type
  default: process.env[datadogApiKeyType.envVar],
  message: datadogApiKeyType.message,
  name: datadogApiKeyType.envVar,
  type: 'input',
  validate: (value) => {
    if (!value || !sentenceMatchesRegEx(value, DATADOG_API_KEY_REG_EXP)) {
      return 'Enter a valid Datadog API Key.'
    }

    return true
  },
})

export const confirmationQuestion = (message: string): ConfirmQuestion => ({
  message,
  name: 'confirmation',
  type: 'confirm',
})

export const functionSelectionQuestion = (functionNames: string[]): CheckboxQuestion => ({
  choices: functionNames,
  message: 'Select the functions to modify',
  name: 'functions',
  type: 'checkbox',
  validate: (selectedFunctions) => {
    if (selectedFunctions.length < 1) {
      return 'You must choose at least one function.'
    }

    return true
  },
})

export const requestAWSCredentials = async () => {
  try {
    const awsCredentialsAnswers = await prompt(awsCredentialsQuestions)
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

export const requestAWSRegion = async (defaultRegion?: string) => {
  try {
    const awsRegionAnswer = await prompt(awsRegionQuestion(defaultRegion))
    process.env[AWS_DEFAULT_REGION_ENV_VAR] = awsRegionAnswer[AWS_DEFAULT_REGION_ENV_VAR]
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set AWS region. ${e.message}`)
    }
  }
}

export const requestDatadogEnvVars = async () => {
  try {
    const datadogSiteAnswer = await prompt(datadogSiteQuestion)
    const selectedDatadogSite = datadogSiteAnswer[CI_SITE_ENV_VAR]
    process.env[CI_SITE_ENV_VAR] = selectedDatadogSite

    const datadogApiKeyTypeAnswer = await prompt(datadogApiKeyTypeQuestion(selectedDatadogSite))
    const datadogApiKeyType = datadogApiKeyTypeAnswer.type
    const datadogEnvVars = await prompt(datadogEnvVarsQuestions(datadogApiKeyType))
    const selectedDatadogApiKeyEnvVar = datadogApiKeyType.envVar
    process.env[selectedDatadogApiKeyEnvVar] = datadogEnvVars[selectedDatadogApiKeyEnvVar]
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set Datadog Environment Variables. ${e.message}`)
    }
  }
}

export const requestEnvServiceVersion = async () => {
  try {
    const envTagAnswer = await prompt(envTagQuestion)
    const inputedEnvTag = envTagAnswer[ENV_TAG]
    process.env[ENV_TAG] = inputedEnvTag

    const serviceTagAnswer = await prompt(serviceTagQuestion)
    const inputedServiceTag = serviceTagAnswer[SERVICE_TAG]
    process.env[SERVICE_TAG] = inputedServiceTag

    const versionTagAnswer = await prompt(versionTagQuestion)
    const versionEnvTag = versionTagAnswer[VERSION_TAG]
    process.env[VERSION_TAG] = versionEnvTag


  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set user defined env, service, and version environment variables. ${e.message}`)
    }
  }
}

export const requestChangesConfirmation = async (message: string) => {
  try {
    const confirmationAnswer = await prompt(confirmationQuestion(message))

    return confirmationAnswer.confirmation
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't receive confirmation. ${e.message}`)
    }
  }
}

export const requestFunctionSelection = async (functionNames: string[]) => {
  try {
    const selectedFunctionsAnswer = await prompt(functionSelectionQuestion(functionNames))

    return selectedFunctionsAnswer.functions
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't receive selected functions. ${e.message}`)
    }
  }
}
