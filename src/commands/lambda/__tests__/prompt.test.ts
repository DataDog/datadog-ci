jest.mock('inquirer')
import {prompt} from 'inquirer'

import {CI_API_KEY_ENV_VAR, CI_SITE_ENV_VAR} from '../../../constants'
import {MOCK_DATADOG_API_KEY} from '../../../helpers/__tests__/testing-tools'

import {
  AWS_ACCESS_KEY_ID_ENV_VAR,
  AWS_SECRET_ACCESS_KEY_ENV_VAR,
  AWS_SESSION_TOKEN_ENV_VAR,
  CI_API_KEY_SECRET_ARN_ENV_VAR,
  CI_KMS_API_KEY_ENV_VAR,
} from '../constants'
import {
  datadogApiKeyTypeQuestion,
  datadogEnvVarsQuestions,
  functionSelectionQuestion,
  requestAWSCredentials,
  requestDatadogEnvVars,
  requestFunctionSelection,
} from '../prompt'

import {mockAwsAccessKeyId, mockAwsSecretAccessKey} from './fixtures'

describe('prompt', () => {
  describe('datadogApiKeyTypeQuestion', () => {
    test('returns question with message pointing to the correct given site', async () => {
      const site = 'datadoghq.com'
      const question = datadogApiKeyTypeQuestion(site)
      expect(await question.message).toBe(
        `Which type of Datadog API Key you want to set? \nLearn more at https://app.${site}/organization-settings/api-keys`
      )
    })
  })

  describe('datadogEnvVarsQuestions', () => {
    test('returns correct message when user selects DATADOG_API_KEY', async () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(await question.message).toBe('API Key:')
      expect(question.name).toBe(CI_API_KEY_ENV_VAR)
    })

    test('validates DATADOG_API_KEY correctly', () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(question.validate).not.toBeUndefined()

      expect(question.validate!('')).not.toBe(true)
      expect(question.validate!('123abc')).not.toBe(true)

      expect(question.validate!('1234567890abcdef1200791a6a0de187')).toBe(true)
    })

    test('returns correct message when user selects DATADOG_KMS_API_KEY', async () => {
      const datadogApiKeyType = {
        envVar: CI_KMS_API_KEY_ENV_VAR,
        message: 'KMS API Key:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(await question.message).toBe('KMS API Key:')
      expect(question.name).toBe(CI_KMS_API_KEY_ENV_VAR)
    })

    test('returns correct message when user selects DATADOG_API_KEY_SECRET_ARN', async () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(await question.message).toBe('API Key Secret ARN:')
      expect(question.name).toBe(CI_API_KEY_SECRET_ARN_ENV_VAR)
    })

    test('validates DATADOG_API_KEY_SECRET_ARN correctly', () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)

      expect(question.validate).not.toBeUndefined()

      expect(question.validate!('')).not.toBe(true)
      expect(question.validate!('123abc')).not.toBe(true)
      expect(question.validate!('1234567890abcdef1200791a6a0de187')).not.toBe(true)

      expect(question.validate!('arn:aws:secretsmanager:sa-east-1:123456789012:secret:dd-api-key')).toBe(true)
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
        })
      )

      await requestAWSCredentials()

      expect(process.env[AWS_ACCESS_KEY_ID_ENV_VAR]).toBe(mockAwsAccessKeyId)
      expect(process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR]).toBe(mockAwsSecretAccessKey)
    })

    test('sets the AWS credentials with session token as environment variables', async () => {
      ;(prompt as any).mockImplementation(() =>
        Promise.resolve({
          [AWS_ACCESS_KEY_ID_ENV_VAR]: mockAwsAccessKeyId,
          [AWS_SECRET_ACCESS_KEY_ENV_VAR]: mockAwsSecretAccessKey,
          [AWS_SESSION_TOKEN_ENV_VAR]: 'some-session-token',
        })
      )

      await requestAWSCredentials()

      expect(process.env[AWS_ACCESS_KEY_ID_ENV_VAR]).toBe(mockAwsAccessKeyId)
      expect(process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR]).toBe(mockAwsSecretAccessKey)
      expect(process.env[AWS_SESSION_TOKEN_ENV_VAR]).toBe('some-session-token')
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
              [CI_API_KEY_ENV_VAR]: MOCK_DATADOG_API_KEY,
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
      expect(process.env[CI_API_KEY_ENV_VAR]).toBe(MOCK_DATADOG_API_KEY)
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
