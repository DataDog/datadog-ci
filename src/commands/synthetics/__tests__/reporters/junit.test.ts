import {promises as fs} from 'fs'

import {JUnitReporter, getDefaultStats} from '../../reporters/junit'
import {RunTestCommand} from '../../run-test'

const globalTestMock = {
  tags: [],
  locations: [],
  options: {},
}

const globalResultMock = {
  result: {stepDetails: [], device: {}},
}

describe('Junit reporter', () => {
  const writeMock = jest.fn()
  const commandMock: any = {
    context: {
      stdout: {
        write: writeMock,
      },
    },
    jUnitReport: 'junit',
  }

  // Using "any" to access private properties
  let reporter: any

  describe('constructor', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestCommand)
    })
    it('should update destination with .xml if needed', () => {
      expect(reporter.destination).toBe('junit.xml')
    })

    it('should give a default run name', () => {
      expect(reporter.json.testsuites.$.name).toBe('Undefined run')
    })
  })

  describe('runEnd', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestCommand)
      // Also mock implementation so it doesn't write the file during the test
      jest.spyOn(fs, 'writeFile').mockImplementation(jest.fn())
      jest.spyOn(reporter.builder, 'buildObject')
    })

    it('should build the xml', async () => {
      await reporter.runEnd()
      expect(reporter.builder.buildObject).toHaveBeenCalledWith(reporter.json)
      expect(fs.writeFile).toHaveBeenCalledWith('junit.xml', expect.any(String), 'utf8')
      expect(commandMock.context.stdout.write).toHaveBeenCalledTimes(1)
    })

    it('should gracefully fail', async () => {
      jest.spyOn(reporter.builder, 'buildObject').mockImplementation(() => {
        throw new Error('Fail')
      })

      await reporter.runEnd()

      expect(fs.writeFile).not.toHaveBeenCalled()
      expect(commandMock.context.stdout.write).toHaveBeenCalledTimes(1)
    })
  })

  describe('testEnd', () => {
    beforeEach(() => {
      reporter = new JUnitReporter(commandMock as RunTestCommand)
    })

    it('should give a default suite name', () => {
      reporter.testEnd({}, [])
      const testsuite = reporter.json.testsuites.testsuite[0]
      expect(testsuite.$.name).toBe('Undefined suite')
    })

    it('should use the same report for tests from same suite', () => {
      const testMock = {
        suite: 'Suite 1',
      }
      reporter.testEnd(testMock, [])
      reporter.testEnd(testMock, [])
      expect(reporter.json.testsuites.testsuite.length).toBe(1)
    })

    it('should add stats to the run', () => {
      reporter.testEnd({}, [])
      const testsuite = reporter.json.testsuites.testsuite[0]
      expect(testsuite.$).toMatchObject(getDefaultStats())
    })

    it('should populate the report with steps', () => {
      const testMock = {
        suite: 'Sweet Suite',
        ...globalTestMock,
      }
      const resultMock = [
        {
          ...globalResultMock,
          ...{
            result: {
              ...globalResultMock.result,
              stepDetails: [
                {
                  description: 'Step 1',
                },
                {
                  description: 'Step 2',
                },
              ],
            },
          },
        },
      ]
      reporter.testEnd(testMock, resultMock)
      const testsuite = reporter.json.testsuites.testsuite[0].testsuite[0]
      expect(testsuite.testcase.length).toBe(resultMock[0].result.stepDetails.length)
    })
  })

  describe('getTestSuite', () => {
    it('should add stats to the suite', () => {
      const resultMock = {
        ...globalResultMock,
        ...{
          result: {
            ...globalResultMock.result,
            stepDetails: [
              {
                description: 'Step 1',
              },
              {
                description: 'Step 2',
                subTestStepDetails: [{description: 'Subtest 1'}],
                browserErrors: [{type: 'error', name: 'Error'}],
                error: 'Error',
                warnings: [{type: 'warning', message: 'Warning'}],
              },
            ],
          },
        },
      }
      const suite = reporter.getTestSuite(globalTestMock, resultMock)
      expect(suite.$).toMatchObject({
        ...getDefaultStats(),
        tests: 3,
        assertions: 3,
        warnings: 1,
        errors: 2,
        failures: 1,
      })
    })
  })

  describe('getStep', () => {
    it('should add stats to the testcase', () => {
      const test = reporter.getStep({})[0]
      expect(test.$).toMatchObject({
        ...getDefaultStats(),
        tests: 1,
        assertions: 1,
      })
    })

    it('should merge subTests', () => {
      const tests = reporter.getStep({description: 'Step 2', subTestStepDetails: [{description: 'Subtest 1'}]})
      expect(tests.length).toBe(2)
    })

    it('should add vitals if present', () => {
      const test = reporter.getStep({vitalsMetrics: [{test: 'test'}]})[0]
      expect(test.vitals).toEqual([{$: {test: 'test'}}])
    })

    it('should add browser errors, errors and warnings', () => {
      const testMock = {
        ...globalTestMock,
        ...{
          browserErrors: [{type: 'error', name: 'Error'}],
          error: 'Error',
          warnings: [{type: 'warning', message: 'Warning'}],
        },
      }
      const test = reporter.getStep(testMock)[0]
      expect(test.error.length).toBe(1)
      expect(test.browser_error.length).toBe(1)
      expect(test.warning.length).toBe(1)
      expect(test.$).toMatchObject({
        ...getDefaultStats(),
        tests: 1,
        assertions: 1,
        warnings: 1,
        errors: 2,
        failures: 1,
      })
    })
  })
})
