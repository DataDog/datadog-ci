import {createCommand, makeRunCLI} from '../../../helpers/__tests__/testing-tools'

import {DeploymentGateCommand} from '../gate'

describe('gate', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentGateCommand, ['deployment', 'gate'], {skipResetEnv: true})

    let originalEnv: NodeJS.ProcessEnv
    beforeEach(() => {
      originalEnv = {...process.env}
    })

    afterEach(() => {
      process.env = originalEnv
    })

    test('should fail if service is not provided', async () => {
      const {context, code} = await runCLI(['--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Missing required parameter: --service')
    })

    test('should fail if env is not provided', async () => {
      const {context, code} = await runCLI(['--service', 'test-service'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Missing required parameter: --env')
    })

    test('should fail if API key is not provided', async () => {
      delete process.env.DATADOG_API_KEY
      delete process.env.DD_API_KEY

      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Neither DATADOG_API_KEY nor DD_API_KEY is in your environment')
    })

    test('should fail if APP key is not provided', async () => {
      delete process.env.DATADOG_APP_KEY
      delete process.env.DD_APP_KEY

      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Neither DATADOG_APP_KEY nor DD_APP_KEY is in your environment')
    })

    test('should fail if timeout is invalid', async () => {
      const {context, code} = await runCLI(['--service', 'test-service', '--env', 'prod', '--timeout', 'invalid'])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toContain('Invalid timeout value. Must be a positive integer.')
    })
  })

  describe('buildEvaluationRequest', () => {
    test('should build basic request with required parameters', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
      })
    })

    test('should include version when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['version'] = '1.2.3'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        version: '1.2.3',
      })
    })

    test('should include apm_primary_tag when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['apmPrimaryTag'] = 'team:backend'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        apm_primary_tag: 'team:backend',
      })
    })

    test('should include both version and apm_primary_tag when provided', () => {
      const command = createCommand(DeploymentGateCommand)
      command['service'] = 'test-service'
      command['env'] = 'prod'
      command['identifier'] = 'default'
      command['version'] = '1.2.3'
      command['apmPrimaryTag'] = 'team:backend'

      const request = command['buildEvaluationRequest']()
      expect(request).toEqual({
        service: 'test-service',
        env: 'prod',
        identifier: 'default',
        version: '1.2.3',
        apm_primary_tag: 'team:backend',
      })
    })
  })
})
