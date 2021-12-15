jest.mock('inquirer')
import {blueBright} from 'chalk'
import {prompt} from 'inquirer'
import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_DEFAULT_REGION_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  CI_API_KEY_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
  CI_SITE_ENV_VAR,
} from '../constants'
import {
  confirmationQuestion,
  datadogApiKeyTypeQuestion,
  datadogEnvVarsQuestions,
  functionSelectionQuestion,
  requestAWSCredentials,
  requestChangesConfirmation,
  requestDatadogEnvVars,
  requestFunctionSelection,
} from '../prompt'
import {mockAwsAccessKeyId, mockAwsSecretAccessKey, mockDatadogApiKey} from './fixtures'

describe('prompt', () => {
  describe('confirmationQuestion', () => {
    test('returns question with provided message', () => {
      const message = 'Do you wanna continue?'
      const question = confirmationQuestion(message)
      expect(question.message).toBe(message)
    })
  })

  describe('datadogApiKeyTypeQuestion', () => {
    test('returns question with message pointing to the correct given site', () => {
      const site = 'datadoghq.com'
      const question = datadogApiKeyTypeQuestion(site)
      expect(question.message).toBe(
        `Which type of Datadog API Key you want to set? \nLearn more at ${blueBright(
          `https://app.${site}/organization-settings/api-keys`
        )}`
      )
    })
  })

  describe('datadogEnvVarsQuestions', () => {
    test('returns correct message when user selects DATADOG_API_KEY', () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(question.message).toBe('API Key:')
      expect(question.name).toBe(CI_API_KEY_ENV_VAR)
    })

    test('returns correct message when user selects DATADOG_KMS_API_KEY', () => {
      const datadogApiKeyType = {
        envVar: CI_KMS_API_KEY_ENV_VAR,
        message: 'KMS API Key:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(question.message).toBe('KMS API Key:')
      expect(question.name).toBe(CI_KMS_API_KEY_ENV_VAR)
    })

    test('returns correct message when user selects DATADOG_API_KEY_SECRET_ARN', () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(question.message).toBe('API Key Secret ARN:')
      expect(question.name).toBe(CI_API_KEY_SECRET_ARN_ENV_VAR)
    })
  })

  describe('functionSelectionQuestion', () => {
    test('returns question with the provided function names being its choices', () => {
      const functionNames = ['my-func', 'my-func-2', 'my-third-func']
      const question = functionSelectionQuestion(functionNames)
      expect(question.choices).toBe(functionNames)
    })
  })

  describe('requestAWSCrendentials', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })
    test('sets the AWS credentials as environment variables', async () => {
      ;(prompt as any).mockImplementation(() =>
        Promise.resolve({
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_DEFAULT_REGION_ENV_VAR]: 'sa-east-1',
        })
      )

      await requestAWSCredentials()

      expect(process.env[AWS_ACCESS_KEY_ID_ENV_VAR]).toBe(mockAwsAccessKeyId)
      expect(process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR]).toBe(mockAwsSecretAccessKey)
      expect(process.env[AWS_DEFAULT_REGION_ENV_VAR]).toBe('sa-east-1')
    })

    test('throws error when something unexpected happens while prompting', async () => {
      ;(prompt as any).mockImplementation(() => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await requestAWSCredentials()
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe("Couldn't set AWS Credentials. Unexpected error")
    })
  })

  describe('requestChangesConfirmation', () => {
    test('returns boolean when users responds to confirmation question', async () => {
      ;(prompt as any).mockImplementation(() =>
        Promise.resolve({
          confirmation: true,
        })
      )

      const confirmation = await requestChangesConfirmation('Do you wanna continue?')
      expect(confirmation).toBe(true)
    })

    test('throws error when something unexpected happens while prompting', async () => {
      ;(prompt as any).mockImplementation(() => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await requestChangesConfirmation('Do you wanna continue?')
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe("Couldn't receive confirmation. Unexpected error")
    })
  })

  describe('requestDatadogEnvVars', () => {
    const OLD_ENV = process.env
    beforeEach(() => {
      jest.resetModules()
      process.env = {}
    })
    afterAll(() => {
      process.env = OLD_ENV
    })
    test('sets the Datadog Environment Variables as provided/selected by user', async () => {
      const site = 'datadoghq.com'
      ;(prompt as any).mockImplementation((question: any) => {
        switch (question.name) {
          case CI_API_KEY_ENV_VAR:
            return Promise.resolve({
              [CI_API_KEY_ENV_VAR]: mockDatadogApiKey,
            })
          case CI_SITE_ENV_VAR:
            return Promise.resolve({
              [CI_SITE_ENV_VAR]: 'datadoghq.com',
            })
          case 'type':
            return Promise.resolve({
              type: {
                envVar: CI_API_KEY_ENV_VAR,
                message: 'API Key:',
              },
            })
          default:
        }
      })

      await requestDatadogEnvVars()

      expect(process.env[CI_SITE_ENV_VAR]).toBe(site)
      expect(process.env[CI_API_KEY_ENV_VAR]).toBe(mockDatadogApiKey)
    })

    test('throws error when something unexpected happens while prompting', async () => {
      ;(prompt as any).mockImplementation(() => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await requestDatadogEnvVars()
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe("Couldn't set Datadog Environment Variables. Unexpected error")
    })
  })

  describe('requestFunctionSelection', () => {
    const selectedFunctions = ['my-func', 'my-func-2', 'my-third-func']
    test('returns the selected functions', async () => {
      ;(prompt as any).mockImplementation(() => Promise.resolve({functions: selectedFunctions}))

      const functions = await requestFunctionSelection(selectedFunctions)
      expect(functions).toBe(selectedFunctions)
    })

    test('throws error when something unexpected happens while prompting', async () => {
      ;(prompt as any).mockImplementation(() => Promise.reject(new Error('Unexpected error')))
      let error
      try {
        await requestFunctionSelection(selectedFunctions)
      } catch (e) {
        if (e instanceof Error) {
          error = e
        }
      }
      expect(error?.message).toBe("Couldn't receive selected functions. Unexpected error")
    })
  })
})
