import {checkForError} from '../validation'

describe('validation', () => {
  test('should find no error for SARIF file', () => {
    const err = checkForError('./src/__tests__/fixtures/valid-results.sarif')
    expect(err.length).toBe(0)
  })

  test('results must have rules', () => {
    const err = checkForError('./src/__tests__/fixtures/test_validation/invalid-sarif-no-rule.sarif')
    expect(err.length).toBe(1)
    expect(err[0]).toBe('result references rule my-rule-id but rule not found in the tool section')
  })

  test('rules can be in extensions', () => {
    const err = checkForError('./src/__tests__/fixtures/test_validation/rules-in-extensions.sarif')
    expect(err.length).toBe(0)
  })
})
