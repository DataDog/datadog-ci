import {importEnvironmentFromFile} from '../utils'

const originalProcessEnv = process.env

beforeEach(() => {
  process.env = originalProcessEnv
})

describe('utils', () => {
  describe('importEnvironmentFromFile', () => {
    test('parses properties file correctly', async () => {
      expect(process.env.DATADOG_ENV).toBeUndefined()
      expect(process.env.DATADOG_ENV_WITH_SPACE).toBeUndefined()
      expect(process.env.DATADOG_ENV_WITH_TAB).toBeUndefined()
      expect(process.env.DATADOG_ENV_NO_VALUE).toBeUndefined()
      await importEnvironmentFromFile(
        './src/commands/react-native/__tests__/fixtures/environment-files/all-cases.properties'
      )
      expect(process.env.DATADOG_ENV).toBe('good_env')
      expect(process.env.DATADOG_ENV_WITH_SPACE).toBe('good_env_space')
      expect(process.env.DATADOG_ENV_WITH_TAB).toBe('good_env_tab')
      expect(process.env['#DATADOG_COMMENT']).toBeUndefined()
      expect(process.env.DATADOG_ENV_NO_VALUE).toBeUndefined()
    })

    test('returns an error if the file does not exist', () => {
      expect(importEnvironmentFromFile('./non-existent/datadog.properties')).rejects.toThrow()
    })
  })
})
