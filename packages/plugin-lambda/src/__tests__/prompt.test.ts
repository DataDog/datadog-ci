jest.mock('@datadog/datadog-ci-base/helpers/inquirer', () => ({
  loadCore: jest.fn(),
  loadPrompts: jest.fn(),
}))
import {MOCK_DATADOG_API_KEY} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {loadCore, loadPrompts} from '@datadog/datadog-ci-base/helpers/inquirer'
import {CI_API_KEY_ENV_VAR, CI_SITE_ENV_VAR} from '@datadog/datadog-ci-base/helpers/serverless/constants'

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
  const mockCheckbox = jest.fn()
  const mockConfirm = jest.fn()
  const mockCreatePrompt = jest.fn()
  const mockInput = jest.fn()
  const mockPassword = jest.fn()
  const mockSearchableCheckboxPrompt = jest.fn()
  const mockSelect = jest.fn()

  beforeEach(() => {
    jest.resetAllMocks()
    ;(loadCore as jest.Mock).mockResolvedValue({
      createPrompt: mockCreatePrompt.mockReturnValue(mockSearchableCheckboxPrompt),
    })
    ;(loadPrompts as jest.Mock).mockResolvedValue({
      checkbox: mockCheckbox,
      confirm: mockConfirm,
      input: mockInput,
      password: mockPassword,
      select: mockSelect,
    })
  })

  describe('datadogApiKeyTypeQuestion', () => {
    test('returns question with message pointing to the correct given site', async () => {
      const site = 'datadoghq.com'
      const question = datadogApiKeyTypeQuestion(site)
      expect(question.message).toBe(
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
      expect(question.message).toBe('API Key:')
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
      expect(question.message).toBe('KMS API Key:')
    })

    test('returns correct message when user selects DATADOG_API_KEY_SECRET_ARN', async () => {
      const datadogApiKeyType = {
        envVar: CI_API_KEY_SECRET_ARN_ENV_VAR,
        message: 'API Key Secret ARN:',
      }
      const question = datadogEnvVarsQuestions(datadogApiKeyType)
      expect(question.message).toBe('API Key Secret ARN:')
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
      expect(question.choices).toEqual(functionNames)
      expect(question.message).toBe(
        'Select the functions to modify (Press <space> to select, p.s. start typing the name instead of manually scrolling)'
      )
      expect(question.validate(['my-func'])).toBe(true)
      expect(question.validate([])).toBe('You must choose at least one function.')
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
      mockInput.mockResolvedValue(mockAwsAccessKeyId)
      mockPassword.mockResolvedValueOnce(mockAwsSecretAccessKey).mockResolvedValueOnce(undefined)

      await requestAWSCredentials()

      expect(process.env[AWS_ACCESS_KEY_ID_ENV_VAR]).toBe(mockAwsAccessKeyId)
      expect(process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR]).toBe(mockAwsSecretAccessKey)
    })

    test('sets the AWS credentials with session token as environment variables', async () => {
      mockInput.mockResolvedValue(mockAwsAccessKeyId)
      mockPassword.mockResolvedValueOnce(mockAwsSecretAccessKey).mockResolvedValueOnce('some-session-token')

      await requestAWSCredentials()

      expect(process.env[AWS_ACCESS_KEY_ID_ENV_VAR]).toBe(mockAwsAccessKeyId)
      expect(process.env[AWS_SECRET_ACCESS_KEY_ENV_VAR]).toBe(mockAwsSecretAccessKey)
      expect(process.env[AWS_SESSION_TOKEN_ENV_VAR]).toBe('some-session-token')
    })

    test('throws error when something unexpected happens while prompting', async () => {
      mockInput.mockRejectedValue(new Error('Unexpected error'))
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
      mockSelect.mockResolvedValueOnce(site).mockResolvedValueOnce({
        envVar: CI_API_KEY_ENV_VAR,
        message: 'API Key:',
      })
      mockInput.mockResolvedValue(MOCK_DATADOG_API_KEY)

      await requestDatadogEnvVars()

      expect(process.env[CI_SITE_ENV_VAR]).toBe(site)
      expect(process.env[CI_API_KEY_ENV_VAR]).toBe(MOCK_DATADOG_API_KEY)
    })

    test('throws error when something unexpected happens while prompting', async () => {
      mockSelect.mockRejectedValue(new Error('Unexpected error'))
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
      mockSearchableCheckboxPrompt.mockResolvedValue(selectedFunctions)

      const functions = await requestFunctionSelection(selectedFunctions)
      expect(functions).toEqual(selectedFunctions)
      expect(mockCreatePrompt).toHaveBeenCalledTimes(1)
      expect(mockSearchableCheckboxPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          choices: selectedFunctions,
          message:
            'Select the functions to modify (Press <space> to select, p.s. start typing the name instead of manually scrolling)',
          pageSize: 10,
        })
      )
    })

    test('throws error when something unexpected happens while prompting', async () => {
      mockSearchableCheckboxPrompt.mockRejectedValue(new Error('Unexpected error'))
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
