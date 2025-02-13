jest.mock('fs/promises')
import * as fsPromises from 'fs/promises'

import {ImportTestsCommandConfig, Result, LocalTestDefinition} from '../interfaces'
import * as multilocator from '../multilocator'
import {updateLTDMultiLocators} from '../multilocator'
import * as tests from '../test'

import {getBrowserTest, getBrowserResult, mockReporter, getStep} from './fixtures'

describe('multilocator', () => {
  let mockConfig: ImportTestsCommandConfig
  let mockResults: Result[]
  let mockTestConfig: {tests: {local_test_definition: LocalTestDefinition}[]}

  const browserTest = getBrowserTest('test-1')
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const {message, monitor_id, status, tags, ...baseBrowserLTD} = browserTest

  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()

    mockConfig = {files: ['test.json']} as ImportTestsCommandConfig
    mockResults = [
      getBrowserResult('result-1', browserTest, {
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
            ...baseBrowserLTD,
            public_id: 'test-1',
            steps: [{params: {element: {}}}, {params: {element: {}}}],
          },
        },
      ],
    }

    jest.spyOn(tests, 'getTestConfigs').mockResolvedValue(mockTestConfig.tests)
    jest.spyOn(multilocator, 'promptUser').mockResolvedValue(true)
    jest.spyOn(fsPromises, 'writeFile').mockImplementation(async () => Promise.resolve())
  })

  describe('updateLTDMultiLocators', () => {
    test('should update MultiLocators when updates exist and user confirms', async () => {
      await updateLTDMultiLocators(mockReporter, mockConfig, mockResults)

      expect(tests.getTestConfigs).toHaveBeenCalledWith(mockConfig, mockReporter)
      const steps = mockTestConfig.tests[0].local_test_definition.steps ?? []
      expect(steps[1].params.element?.multiLocator).toEqual({
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
      expect(mockReporter.log).toHaveBeenCalledWith(expect.stringContaining('No MultiLocator updates found. No changes will be made.'))
    })

    test('should not overwrite file if user declines update prompt', async () => {
      jest.spyOn(multilocator, 'promptUser').mockResolvedValue(false)

      await updateLTDMultiLocators(mockReporter, mockConfig, mockResults)

      expect(tests.getTestConfigs).not.toHaveBeenCalled()
      expect(fsPromises.writeFile).not.toHaveBeenCalled()
      expect(mockReporter.log).toHaveBeenCalledWith(expect.stringContaining('MultiLocator updates aborted by user.'))
    })

    test('should handle errors during file write gracefully', async () => {
      jest.spyOn(fsPromises, 'writeFile').mockRejectedValue(new Error('Write failed'))

      await expect(updateLTDMultiLocators(mockReporter, mockConfig, mockResults)).resolves.not.toThrow()

      expect(fsPromises.writeFile).toHaveBeenCalled()
      expect(mockReporter.error).toHaveBeenCalledWith(expect.stringContaining('Error writing to file'))
    })
    test('should throw an error if multiple LTDs with the same publicId are found', async () => {
      mockTestConfig.tests.push({
        local_test_definition: {
          ...baseBrowserLTD,
          public_id: 'test-1', // Duplicate public_id
          steps: [{params: {element: {}}}],
        },
      })

      await expect(updateLTDMultiLocators(mockReporter, mockConfig, mockResults)).rejects.toThrow(
        `Cannot have multiple local test definitions with same publicId: test-1.`
      )

      expect(fsPromises.writeFile).not.toHaveBeenCalled()
    })

    test('should throw an error if no LTD with the publicId is found', async () => {
      jest.spyOn(tests, 'getTestConfigs').mockResolvedValue([])

      await expect(updateLTDMultiLocators(mockReporter, mockConfig, mockResults)).rejects.toThrow(
        `No local test definition found with publicId test-1.`
      )

      expect(fsPromises.writeFile).not.toHaveBeenCalled()
    })
  })
})
