import * as api from '../api'
import {PluginCommand as DeployTestsCommand} from '../commands/deploy-tests'
import {deployTests} from '../deploy-tests-lib'
import * as tests from '../test'

import {
  getApiTest,
  mockApi,
  mockReporter,
  getApiLocalTestDefinition,
  getBrowserLocalTestDefinition,
  getBrowserTest,
} from './fixtures'

describe('deploy-tests', () => {
  describe('deployTests', () => {
    it('deploys local test definitions as new versions of main test definitions', async () => {
      const config = DeployTestsCommand.getDefaultConfig()

      jest
        .spyOn(tests, 'getTestConfigs')
        .mockImplementation(async () => [
          {localTestDefinition: getApiLocalTestDefinition('123-456-789')},
          {localTestDefinition: getBrowserLocalTestDefinition('987-654-321')},
        ])

      const apiHelper = mockApi({
        getTest: jest.fn(async (publicId: string) => {
          return getApiTest(publicId)
        }),
        editTest: jest.fn(),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await deployTests(mockReporter, config)

      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(2)
      expect(apiHelper.editTest).toHaveBeenCalledTimes(2)

      expect(apiHelper.getTest).toHaveBeenNthCalledWith(1, '123-456-789')
      expect(apiHelper.getTest).toHaveBeenNthCalledWith(2, '987-654-321')

      // eslint-disable-next-line @typescript-eslint/naming-convention, prefer-const
      let {public_id, monitor_id, ...expectedUpdate} = getApiTest('123-456-789')
      expect(apiHelper.editTest).toHaveBeenNthCalledWith(1, '123-456-789', expectedUpdate)
      ;({public_id, monitor_id, ...expectedUpdate} = getBrowserTest('987-654-321'))
      expect(apiHelper.editTest).toHaveBeenNthCalledWith(2, '987-654-321', expectedUpdate)
    })

    it('supports specifying public ids', async () => {
      const config = DeployTestsCommand.getDefaultConfig()
      config['publicIds'] = ['123-456-789']

      jest
        .spyOn(tests, 'getTestConfigs')
        .mockImplementation(async () => [
          {localTestDefinition: getApiLocalTestDefinition('123-456-789')},
          {localTestDefinition: getBrowserLocalTestDefinition('987-654-321')},
        ])

      const apiHelper = mockApi({
        getTest: jest.fn(async (publicId: string) => {
          return getApiTest(publicId)
        }),
        editTest: jest.fn(),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await deployTests(mockReporter, config)

      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
      expect(apiHelper.editTest).toHaveBeenCalledTimes(1)

      expect(apiHelper.getTest).toHaveBeenNthCalledWith(1, '123-456-789')

      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {public_id, monitor_id, ...expectedUpdate} = getApiTest('123-456-789')
      expect(apiHelper.editTest).toHaveBeenNthCalledWith(1, '123-456-789', expectedUpdate)
    })

    it('excludes specified fields from the payload', async () => {
      const config = DeployTestsCommand.getDefaultConfig()
      config['excludeFields'] = ['config', 'locations', 'options.device_ids']

      const localTest = getApiLocalTestDefinition('123-456-789', {
        config: {
          assertions: [],
          request: {
            headers: {},
            method: 'POST',
            timeout: 120000,
            url: 'http://new.url',
          },
          variables: [],
        },
        locations: ['new-location'],
        options: {
          device_ids: ['local-device-id'],
        },
      })

      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [{localTestDefinition: localTest}])

      const existingRemoteTest = getApiTest('123-456-789', {
        config: {
          assertions: [],
          request: {
            headers: {},
            method: 'GET',
            timeout: 60000,
            url: 'http://old.url',
          },
          variables: [],
        },
        locations: ['old-location'],
        options: {
          device_ids: ['remote-device-id'],
        },
      })

      const apiHelper = mockApi({
        getTest: jest.fn(async () => existingRemoteTest),
        editTest: jest.fn(),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await deployTests(mockReporter, config)

      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
      expect(apiHelper.editTest).toHaveBeenCalledTimes(1)

      const expectedTest = {
        ...localTest,
        config: existingRemoteTest.config,
        locations: existingRemoteTest.locations,
        options: {
          device_ids: existingRemoteTest.options.device_ids,
        },
        message: '',
        status: 'live',
        tags: [],
      }
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {public_id, ...expectedUpdate} = expectedTest
      expect(apiHelper.editTest).toHaveBeenCalledWith('123-456-789', expectedUpdate)
    })

    it('excludes config field by default', async () => {
      const config = DeployTestsCommand.getDefaultConfig()

      const localTest = getApiLocalTestDefinition('123-456-789', {
        config: {
          assertions: [],
          request: {
            headers: {},
            method: 'POST',
            timeout: 60000,
            url: 'http://new.url',
          },
          variables: [],
        },
      })

      jest.spyOn(tests, 'getTestConfigs').mockImplementation(async () => [{localTestDefinition: localTest}])

      const existingRemoteTest = getApiTest('123-456-789', {
        config: {
          assertions: [],
          request: {
            headers: {},
            method: 'GET',
            timeout: 60000,
            url: 'http://old.url',
          },
          variables: [],
        },
      })

      const apiHelper = mockApi({
        getTest: jest.fn(async () => existingRemoteTest),
        editTest: jest.fn(),
      })
      jest.spyOn(api, 'getApiHelper').mockImplementation(() => apiHelper as any)

      await deployTests(mockReporter, config)

      expect(tests.getTestConfigs).toHaveBeenCalledTimes(1)
      expect(apiHelper.getTest).toHaveBeenCalledTimes(1)
      expect(apiHelper.editTest).toHaveBeenCalledTimes(1)

      // The final test should have the config from the remote test
      const expectedTest = {
        ...localTest,
        config: existingRemoteTest.config,
        message: '',
        status: 'live',
        tags: [],
      }
      // eslint-disable-next-line @typescript-eslint/naming-convention
      const {public_id, ...expectedUpdate} = expectedTest
      expect(apiHelper.editTest).toHaveBeenCalledWith('123-456-789', expectedUpdate)
    })
  })
})
