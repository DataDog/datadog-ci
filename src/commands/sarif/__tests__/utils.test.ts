import {
  getServiceFromSarifTool,
  SERVICE_DATADOG_ANALYZER,
  SERVICE_DATADOG_ANALYZER_SA_ONLY,
  SERVICE_DATADOG_ANALYZER_SECRETS_ONLY,
  SERVICE_THIRD_PARTY_ANALYZER,
} from '../utils'

describe('validation of service and env', () => {
  test('should correctly handle for datadog analyzer with static analysis only', () => {
    const service = getServiceFromSarifTool('./src/commands/sarif/__tests__/fixtures/datadog-sa-only.json')
    expect(service).toBe(SERVICE_DATADOG_ANALYZER_SA_ONLY)
  })
  test('should correctly handle for datadog analyzer with secrets only', () => {
    const service = getServiceFromSarifTool('./src/commands/sarif/__tests__/fixtures/datadog-secrets-only-empty.json')
    expect(service).toBe(SERVICE_DATADOG_ANALYZER_SECRETS_ONLY)
  })
  test('should correctly handle for datadog analyzer with static analysis and secrets', () => {
    const service = getServiceFromSarifTool('./src/commands/sarif/__tests__/fixtures/datadog-sa-secrets.json')
    expect(service).toBe(SERVICE_DATADOG_ANALYZER)
  })
  test('third party tool', () => {
    const service = getServiceFromSarifTool('./src/commands/sarif/__tests__/fixtures/valid-results.sarif')
    expect(service).toBe('ESLint')
  })
  test('invalid file', () => {
    const service = getServiceFromSarifTool('./src/commands/sarif/__tests__/fixtures/invalid.sarif')
    expect(service).toBe(SERVICE_THIRD_PARTY_ANALYZER)
  })
})
