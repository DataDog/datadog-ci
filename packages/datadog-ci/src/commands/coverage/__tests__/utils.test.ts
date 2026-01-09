import {
  cloverFormat,
  coberturaFormat,
  detectFormat,
  goCoverprofileFormat,
  jacocoFormat,
  lcovFormat,
  opencoverFormat,
  simplecovFormat,
  simplecovInternalFormat,
  validateCoverageReport,
} from '../utils'

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

    test('Returns undefined for a valid lcov Bazel report', async () => {
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

    test('Returns undefined for a valid cobertura report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/cobertura.xml'
      expect(validateCoverageReport(filePath, coberturaFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid cobertura report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/cobertura-invalid.xml'
      expect(validateCoverageReport(filePath, coberturaFormat)).toMatch(/.+/)
    })

    test('Returns undefined for a valid simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage.json'
      expect(validateCoverageReport(filePath, simplecovFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage-invalid.json'
      expect(validateCoverageReport(filePath, simplecovFormat)).toMatch(/.+/)
    })

    test('Returns error message for an old simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage-old.json'
      expect(validateCoverageReport(filePath, simplecovFormat)).toMatch(/.+/)
    })

    test('Returns undefined for a valid internal simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/.resultset.json'
      expect(validateCoverageReport(filePath, simplecovInternalFormat)).toBeUndefined()
    })

    test('Returns undefined for a valid clover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/clover.xml'
      expect(validateCoverageReport(filePath, cloverFormat)).toBeUndefined()
    })

    test('Returns undefined for a valid clover PHP report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/clover-php.xml'
      expect(validateCoverageReport(filePath, cloverFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid go-coverprofile report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage-invalid.out'
      expect(validateCoverageReport(filePath, goCoverprofileFormat)).toMatch(/.+/)
    })

    test('Returns undefined for a valid go-coverprofile report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage.out'
      expect(validateCoverageReport(filePath, goCoverprofileFormat)).toBeUndefined()
    })

    test('Returns error message for an invalid clover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/clover-invalid.xml'
      expect(validateCoverageReport(filePath, cloverFormat)).toMatch(/.+/)
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

    test('Detects cobertura format for a valid cobertura report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/subfolder.xml/cobertura.xml'
      expect(detectFormat(filePath)).toEqual(coberturaFormat)
    })

    test('Detects simplecov format for a valid simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage.json'
      expect(detectFormat(filePath)).toEqual(simplecovFormat)
    })

    test('Detects simplecov-internal format for a valid internal simplecov report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/.resultset.json'
      expect(detectFormat(filePath)).toEqual(simplecovInternalFormat)
    })

    test('Detects clover format for a valid clover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/clover.xml'
      expect(detectFormat(filePath)).toEqual(cloverFormat)
    })

    test('Detects clover format for a PHP clover report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/clover-php.xml'
      expect(detectFormat(filePath)).toEqual(cloverFormat)
    })

    test('Detects go-coverprofile format for a valid go-coverprofile report', async () => {
      const filePath = './src/commands/coverage/__tests__/fixtures/coverage.out'
      expect(detectFormat(filePath)).toEqual(goCoverprofileFormat)
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
