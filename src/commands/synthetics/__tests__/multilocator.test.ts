jest.mock('fs/promises')
import * as fsPromises from 'fs/promises'

import {ImportTestsCommandConfig, TestConfig, Result} from '../interfaces'
import * as multilocator from '../multilocator'
import {updateLTDMultiLocators} from '../multilocator'
import * as tests from '../test'

import {getBrowserTest, getBrowserResult, mockReporter, getStep} from './fixtures'

describe('multilocator', () => {
  let mockConfig: ImportTestsCommandConfig
  let mockResults: Result[]
  let mockTestConfig: TestConfig

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()

    mockConfig = {files: ['test.json']} as ImportTestsCommandConfig
    mockResults = [
      getBrowserResult('result-1', getBrowserTest('test-1'), {
        stepDetails: [
          getStep(), // Step 0 (ignored)
          getStep(),
          {...getStep(), stepElementUpdates: {multiLocator: {ab: 'xpath-1'}}},
        ],
      }),
    ]
    mockTestConfig = {
      tests: [
        {
          local_test_definition: {
            public_id: 'test-1',
            steps: [{params: {element: {}}}, {params: {element: {}}}],
          },
        },
      ],
    } as TestConfig

    jest.spyOn(tests, 'getTestConfigs').mockResolvedValue(mockTestConfig.tests)
    jest.spyOn(multilocator, 'promptUser').mockResolvedValue(true)
    jest.spyOn(fsPromises, 'writeFile').mockImplementation(async () => Promise.resolve())
  })

  describe('updateLTDMultiLocators', () => {
    test('should update MultiLocators when updates exist and user confirms', async () => {
      await updateLTDMultiLocators(mockReporter, mockConfig, mockResults)

      const testDefinition = mockTestConfig.tests[0] as any
      expect(tests.getTestConfigs).toHaveBeenCalledWith(mockConfig, mockReporter)
      expect(testDefinition.local_test_definition.steps[1].params.element.multiLocator).toEqual({
        ab: 'xpath-1',
      })
      expect(fsPromises.writeFile).toHaveBeenCalledWith('test.json', expect.any(String), 'utf8')
    })

    test('should not modify tests when no MultiLocators exist', async () => {
      mockResults = [
        getBrowserResult('result-1', getBrowserTest('test-1'), {
          stepDetails: [getStep(), {...getStep(), stepElementUpdates: {}}], // No ML updates
        }),
      ]

      await updateLTDMultiLocators(mockReporter, mockConfig, mockResults)

      expect(tests.getTestConfigs).not.toHaveBeenCalled()
      expect(fsPromises.writeFile).not.toHaveBeenCalled()
    })

    test('should not overwrite file if user declines update prompt', async () => {
      jest.spyOn(multilocator, 'promptUser').mockResolvedValue(false)

      await updateLTDMultiLocators(mockReporter, mockConfig, mockResults)

      expect(tests.getTestConfigs).not.toHaveBeenCalled()
      expect(fsPromises.writeFile).not.toHaveBeenCalled()
    })

    test('should handle errors during file write gracefully', async () => {
      jest.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('Write failed'))

      await expect(updateLTDMultiLocators(mockReporter, mockConfig, mockResults)).resolves.not.toThrow()

      expect(fsPromises.writeFile).toHaveBeenCalled()
      expect(mockReporter.error).toHaveBeenCalledWith(expect.stringContaining('Error writing file'))
    })
  })
})
