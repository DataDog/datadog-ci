jest.mock('fs/promises')
import * as fsPromises from 'fs/promises'

import * as api from '../api'
import {DEFAULT_IMPORT_TESTS_COMMAND_CONFIG} from '../import-tests-command'
import {importTests} from '../import-tests-lib'
import {TriggerConfig} from '../interfaces'
import * as tests from '../test'

import {getApiTest, getBrowserTest, mockApi, mockReporter} from './fixtures'

describe('import-tests', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.mock('fs/promises', () => ({
      writeFile: jest.fn().mockResolvedValue(undefined),
    }))
    // jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({}))
    process.env = {}
  })

  describe('importTests', () => {
    // test is written to new file
    // test multiple public_ids
    // test browser test has steps
    // test already existing file is edited
    // test unsupported fields are not present

    test('we write imported test to file', async () => {
      const filePath = 'test.synthetics.json'
      const config = DEFAULT_IMPORT_TESTS_COMMAND_CONFIG
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789']

      const mockTest = getApiTest(config['publicIds'][0])
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {message, monitor_id, status, tags, ...mockTestWithoutUnsupportedFields} = mockTest
      const mockLTD = {
        tests: [
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const jsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getTest: jest.fn(() => {
          return Promise.resolve(mockTest)
        }),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, jsonData, 'utf8')
    })

    test('we can fetch multiple public_ids', async () => {
      const filePath = 'test.synthetics.json'
      const config = DEFAULT_IMPORT_TESTS_COMMAND_CONFIG
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789', '987-654-321']

      const mockTest = getApiTest(config['publicIds'][0])
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {message, monitor_id, status, tags, ...mockTestWithoutUnsupportedFields} = mockTest
      const mockLTD = {
        tests: [
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
              public_id: config['publicIds'][0],
            },
          },
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
              public_id: config['publicIds'][1],
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const expectedJsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getTest: jest
          .fn()
          .mockReturnValueOnce(Promise.resolve(mockTest))
          .mockReturnValueOnce(Promise.resolve({...mockTest, public_id: config['publicIds'][1]})),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getTest).toHaveBeenCalledTimes(2)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, expectedJsonData, 'utf8')
    })

    test('we write browser test', async () => {
      const filePath = 'test.synthetics.json'
      const config = DEFAULT_IMPORT_TESTS_COMMAND_CONFIG
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789']

      const mockTest = getBrowserTest(config['publicIds'][0])
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {message, monitor_id, status, tags, ...mockTestWithoutUnsupportedFields} = mockTest
      const mockLTD = {
        tests: [
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const jsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getTest: jest.fn(() => {
          return Promise.resolve(mockTest)
        }),
        getTestWithType: jest.fn(() => {
          return Promise.resolve(mockTest)
        }),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
      expect(apiHelper.getTestWithType).toHaveBeenCalledTimes(1)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, jsonData, 'utf8')
    })

    test('we write imported test to already existing file', async () => {
      const filePath = 'test.synthetics.json'
      const config = DEFAULT_IMPORT_TESTS_COMMAND_CONFIG
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789', '987-654-321']

      const mockTest = getApiTest(config['publicIds'][0])

      const mockTriggerConfig: TriggerConfig[] = [
        {
          local_test_definition: {
            ...mockTest,
            public_id: 'abc-def-ghi',
          },
        },
        {
          local_test_definition: {
            ...mockTest,
            public_id: config['publicIds'][0],
          },
        },
      ]

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {message, monitor_id, status, tags, ...mockTestWithoutUnsupportedFields} = mockTest
      const expectedLTD = {
        tests: [
          {
            local_test_definition: {
              ...mockTest,
              public_id: 'abc-def-ghi',
            },
          },
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
              public_id: config['publicIds'][0],
              name: 'Some other name',
            },
          },
          {
            local_test_definition: {
              ...mockTestWithoutUnsupportedFields,
              public_id: config['publicIds'][1],
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const expectedJsonData = JSON.stringify(expectedLTD, null, 2)

      const apiHelper = mockApi({
        getTest: jest
          .fn()
          .mockReturnValueOnce(Promise.resolve({...mockTest, name: 'Some other name'}))
          .mockReturnValueOnce(Promise.resolve({...mockTest, public_id: config['publicIds'][1]})),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockResolvedValue(mockTriggerConfig)

      await importTests(mockReporter, config)

      expect(apiHelper.getTest).toHaveBeenCalledTimes(2)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, expectedJsonData, 'utf8')
    })
  })
})
