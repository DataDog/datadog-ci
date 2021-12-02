import {bold} from 'chalk'
import {ListQuestion, prompt, QuestionCollection} from 'inquirer'
import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_ACCESS_KEY_ID_REG_EXP,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_REG_EXP,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
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
    // AWS_SCRET_ACCESS_KEY_ENV_VAR question
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
]

const datadogApiKeyTypeQuestion: ListQuestion = {
  choices: [
    {
      name: `Plain text ${bold('API Key')}`,
      value: {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      },
    },
    {
      name: `AWS Key Management Service ${bold('(KMS) API Key')}`,
      value: {
        envVar: CI_KMS_API_KEY_ENV_VAR,
        message: 'KMS API Key:',
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
  message: 'Which type of Datadog API Key you want to set?',
  name: 'type',
  type: 'list',
}

const datadogEnvVarsQuestions = (datadogApiKeyType: Record<string, any>): QuestionCollection => [
  {
    // DATADOG API KEY given type
    message: datadogApiKeyType.message,
    name: datadogApiKeyType.envVar,
    type: 'input',
    validate: (value) => {
      if (!value) {
        return 'Enter a valid Datadog API Key.'
      }

      return true
    },
  },
  {
    // DATADOG SITE
    choices: SITES,
    message: 'Select the Datadog site to send data.',
    name: CI_SITE_ENV_VAR,
    type: 'list',
  },
]

export const requestAWSCredentials = async () => {
  try {
    const awsCredentialsAnswers = await prompt(awsCredentialsQuestions)
    process.env[AWS_ACCESS_KEY_ID_ENV_VAR] = awsCredentialsAnswers[AWS_ACCESS_KEY_ID_ENV_VAR]
    process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR] = awsCredentialsAnswers[AWS_SECRET_ACCESS_KEY_ENV_VAR]
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set AWS Credentials. ${e}`)
    }
  }
}

export const requestDatadogEnvVars = async () => {
  try {
    const datadogApiKeyTypeAnswer = await prompt(datadogApiKeyTypeQuestion)
    const datadogApiKeyType = datadogApiKeyTypeAnswer.type
    const datadogEnvVars = await prompt(datadogEnvVarsQuestions(datadogApiKeyType))

    process.env[datadogApiKeyType.envVar] = datadogEnvVars[datadogApiKeyType.envVar]
    process.env[CI_SITE_ENV_VAR] = datadogEnvVars[CI_SITE_ENV_VAR]
  } catch (e) {
    if (e instanceof Error) {
      throw Error(`Couldn't set Datadog Environment Variables. ${e}`)
    }
  }
}
