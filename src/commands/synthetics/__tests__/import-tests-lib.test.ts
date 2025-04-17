jest.mock('fs/promises')
import * as fsPromises from 'fs/promises'

import * as api from '../api'
import {ImportTestsCommand} from '../import-tests-command'
import {importTests} from '../import-tests-lib'
import {TriggerConfig} from '../interfaces'
import * as tests from '../test'

import {getApiLocalTestDefinition, mockApi, mockReporter} from './fixtures'

describe('import-tests', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.mock('fs/promises', () => ({
      writeFile: jest.fn().mockResolvedValue(undefined),
    }))
    process.env = {}
  })

  describe('importTests', () => {
    test('we write imported test to file', async () => {
      const filePath = 'test.synthetics.json'
      const config = ImportTestsCommand.getDefaultConfig()
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789']

      const mockTest = getApiLocalTestDefinition(config['publicIds'][0])
      const mockLTD = {
        tests: [
          {
            localTestDefinition: {
              ...mockTest,
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const jsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getLocalTestDefinition: jest.fn(() => {
          return Promise.resolve(mockTest)
        }),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getLocalTestDefinition).toHaveBeenCalledTimes(1)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, jsonData, 'utf8')
    })

    test('we can fetch multiple public_ids', async () => {
      const filePath = 'test.synthetics.json'
      const config = ImportTestsCommand.getDefaultConfig()
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789', '987-654-321']

      const mockTest = getApiLocalTestDefinition(config['publicIds'][0])
      const mockLTD = {
        tests: [
          {
            localTestDefinition: {
              ...mockTest,
              public_id: config['publicIds'][0],
            },
          },
          {
            localTestDefinition: {
              ...mockTest,
              public_id: config['publicIds'][1],
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const expectedJsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getLocalTestDefinition: jest
          .fn()
          .mockReturnValueOnce(Promise.resolve(mockTest))
          .mockReturnValueOnce(Promise.resolve({...mockTest, public_id: config['publicIds'][1]})),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getLocalTestDefinition).toHaveBeenCalledTimes(2)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, expectedJsonData, 'utf8')
    })

    test('we write browser test', async () => {
      const filePath = 'test.synthetics.json'
      const config = ImportTestsCommand.getDefaultConfig()
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789']

      const mockTest = {
        ...getApiLocalTestDefinition(config['publicIds'][0]),
        options: {device_ids: ['chrome.laptop_large']},
        type: 'browser',
      }
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const mockLTD = {
        tests: [
          {
            localTestDefinition: {
              ...mockTest,
              name: 'Some browser test',
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const jsonData = JSON.stringify(mockLTD, null, 2)

      const apiHelper = mockApi({
        getLocalTestDefinition: jest
          .fn()
          .mockReturnValueOnce(Promise.resolve({...mockTest, name: 'Some name'}))
          .mockReturnValueOnce(Promise.resolve({...mockTest, name: 'Some browser test'})),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [])

      await importTests(mockReporter, config)

      expect(apiHelper.getLocalTestDefinition).toHaveBeenCalledTimes(2)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, jsonData, 'utf8')
    })

    test('we write imported test to already existing file', async () => {
      const filePath = 'test.synthetics.json'
      const config = ImportTestsCommand.getDefaultConfig()
      config['files'] = [filePath]
      config['publicIds'] = ['123-456-789', '987-654-321']

      const mockTest = getApiLocalTestDefinition(config['publicIds'][0])

      const mockTriggerConfig: TriggerConfig[] = [
        {
          localTestDefinition: {
            ...mockTest,
            public_id: 'abc-def-ghi',
          },
        },
        {
          localTestDefinition: {
            ...mockTest,
            public_id: config['publicIds'][0],
          },
        },
      ]

      const expectedLTD = {
        tests: [
          {
            localTestDefinition: {
              ...mockTest,
              public_id: 'abc-def-ghi',
            },
          },
          {
            localTestDefinition: {
              ...mockTest,
              public_id: config['publicIds'][0],
              name: 'Some other name',
            },
          },
          {
            localTestDefinition: {
              ...mockTest,
              public_id: config['publicIds'][1],
            },
          },
        ],
      }
      // eslint-disable-next-line no-null/no-null
      const expectedJsonData = JSON.stringify(expectedLTD, null, 2)

      const apiHelper = mockApi({
        getLocalTestDefinition: jest
          .fn()
          .mockReturnValueOnce(Promise.resolve({...mockTest, name: 'Some other name'}))
          .mockReturnValueOnce(Promise.resolve({...mockTest, public_id: config['publicIds'][1]})),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)
      jest.spyOn(tests, 'getTestConfigs').mockResolvedValue(mockTriggerConfig)

      await importTests(mockReporter, config)

      expect(apiHelper.getLocalTestDefinition).toHaveBeenCalledTimes(2)
      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledTimes(1)
      expect(fsPromises.writeFile).toHaveBeenCalledWith(filePath, expectedJsonData, 'utf8')
    })
  })
})
