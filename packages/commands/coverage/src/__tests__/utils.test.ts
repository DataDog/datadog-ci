import {detectFormat, jacocoFormat, lcovFormat, opencoverFormat, validateCoverageReport} from '../utils'

describe('utils', () => {
  describe('validateCoverageReport', () => {
    test('Returns undefined for a valid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(validateCoverageReport(filePath, jacocoFormat)).toBeUndefined()
    })

    test('Returns undefined for a valid Jacoco report with user-provided format', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(validateCoverageReport(filePath, jacocoFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/invalid-jacoco-report.xml'
      expect(validateCoverageReport(filePath, jacocoFormat)).toMatch(/.+/)
    })

    test('Returns error message for a Jacoco report with invalid root tag', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report-incorrect-root-tag.xml'
      expect(validateCoverageReport(filePath, jacocoFormat)).toMatch(/.+/)
    })

    test('Returns undefined for a valid lcov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/lcov.info'
      expect(validateCoverageReport(filePath, lcovFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid lcov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/invalid.lcov'
      expect(validateCoverageReport(filePath, lcovFormat)).toMatch(/.+/)
    })

    test('Returns undefined for a valid opencover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/opencover-coverage.xml'
      expect(validateCoverageReport(filePath, opencoverFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid opencover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/opencover-coverage-invalid.xml'
      expect(validateCoverageReport(filePath, opencoverFormat)).toMatch(/.+/)
    })

    test('Returns error message for a malformed opencover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/opencover-coverage-malformed.xml'
      expect(validateCoverageReport(filePath, opencoverFormat)).toMatch(/.+/)
    })
  })

  describe('detectFormat', () => {
    test('Detects Jacoco format for a valid Jacoco report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/jacoco-report.xml'
      expect(detectFormat(filePath)).toEqual(jacocoFormat)
    })

    test('Detects lcov format for a valid lcov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/lcov.info'
      expect(detectFormat(filePath)).toEqual(lcovFormat)
    })

    test('Detects opencover format for a valid opencover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/opencover-coverage.xml'
      expect(detectFormat(filePath)).toEqual(opencoverFormat)
    })

    test('Returns undefined for an XML file that is not a coverage report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/random-file.xml'
      expect(detectFormat(filePath)).toBeUndefined()
    })

    test('Returns undefined for a text file that is not a coverage report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/non-xml-file.txt'
      expect(detectFormat(filePath)).toBeUndefined()
    })
  })
})
