import {makeRunCLI} from '../../../helpers/__tests__/testing-tools'
import * as apikey from '../../../helpers/apikey'

import {InstrumentCommand} from '../instrument'
import * as utils from '../utils'

jest.mock('../../../helpers/apikey')
jest.mock('../utils')

describe('InstrumentCommand', () => {
  const runCLI = makeRunCLI(InstrumentCommand, ['cloud-run', 'instrument'])

  beforeEach(() => {
    jest.clearAllMocks()
    const mockValidator = {
      validateApiKey: jest.fn().mockResolvedValue(true),
      verifyApiKey: jest.fn().mockResolvedValue(undefined),
    }
    ;(apikey.newApiKeyValidator as jest.Mock).mockReturnValue(mockValidator)
    ;(utils.checkAuthentication as jest.Mock).mockResolvedValue(true)
  })

  describe('validates required variables', () => {
    test('should fail if project is missing', async () => {
      const {code, context} = await runCLI([
        '--services',
        'test-service',
        '--region',
        'us-central1',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No project specified')
    })

    test('should fail if services are missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--region',
        'us-central1',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No services specified')
    })

    test('should fail if region is missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--dd-service',
        'test-service',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No region specified')
    })

    test('should fail if DD_SERVICE is missing', async () => {
      const {code, context} = await runCLI([
        '--project',
        'test-project',
        '--services',
        'test-service',
        '--region',
        'us-central1',
      ])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('No DD_SERVICE specified')
    })
  })
})
