import * as api from '../api'
import {DeployTestsCommand} from '../deploy-tests-command'
import {deployTests} from '../deploy-tests-lib'
import * as tests from '../test'

import {getApiLocalTestDefinition, getApiTest, mockApi, mockReporter} from './fixtures'

describe('deploy-tests', () => {
  describe('deployTests', () => {
    it('deploys local test definitions as new versions of main test definitions', async () => {
      const config = DeployTestsCommand.getDefaultConfig()

      jest
        .spyOn(tests, 'getTestConfigs')
        .mockImplementation(async () => [
          {localTestDefinition: getApiLocalTestDefinition('123-456-789')},
          {localTestDefinition: getApiLocalTestDefinition('987-654-321')},
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

      // eslint-disable-next-line @typescript-eslint/naming-convention
      ;({public_id, monitor_id, ...expectedUpdate} = getApiTest('987-654-321'))
      expect(apiHelper.editTest).toHaveBeenNthCalledWith(2, '987-654-321', expectedUpdate)
    })

    it('supports specifying public ids', async () => {
      const config = DeployTestsCommand.getDefaultConfig()
      config['publicIds'] = ['123-456-789']

      jest
        .spyOn(tests, 'getTestConfigs')
        .mockImplementation(async () => [
          {localTestDefinition: getApiLocalTestDefinition('123-456-789')},
          {localTestDefinition: getApiLocalTestDefinition('987-654-321')},
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
  })
})
