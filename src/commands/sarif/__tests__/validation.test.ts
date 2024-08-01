import {checkForError} from '../validation'

describe('validation', () => {
  test('should find no error for SARIF file', () => {
    expect(checkForError('./src/commands/sarif/__tests__/fixtures/valid-results.sarif')).toBeUndefined()
  })
  test('results must have rules', () => {
    expect(checkForError('./src/commands/sarif/__tests__/fixtures/test_validation/invalid-sarif-no-rule.sarif')).toBe(
      'result references rule my-rule-id but rule not found in the tool section'
    )
  })
})
