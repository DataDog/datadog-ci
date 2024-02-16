import {Cli} from 'clipanion/lib/advanced'

import {createCommand, createMockContext} from '../../../helpers/__tests__/fixtures'
import * as gitFunctions from '../../../helpers/git/get-git-data'
import * as ciUtils from '../../../helpers/utils'

import {SendDeploymentEvent} from '../deployment'
import {DeploymentEvent} from '../interfaces'

describe('deployment', () => {
  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', () => {
      process.env = {}
      const write = jest.fn()
      const command = createCommand(SendDeploymentEvent, {stdout: {write}} as any)

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DD_API_KEY')
    })
    test('should use the correct endpoint', () => {
      process.env = {
        DD_API_KEY: 'PLACEHOLDER',
        DD_APP_KEY: 'PLACEHOLDER',
        DD_SITE: 'us3.datadoghq.com',
      }

      const command = createCommand(SendDeploymentEvent)
      const getRequestBuilder = jest.spyOn(ciUtils, 'getRequestBuilder')

      expect(command['getApiHelper'].bind(command)).not.toThrow()
      expect(getRequestBuilder).toHaveBeenCalledWith(
        expect.objectContaining({
          baseUrl: 'https://api.us3.datadoghq.com',
        })
      )
      process.env = {}
    })
  })
})

const makeCli = () => {
  const cli = new Cli()
  cli.register(SendDeploymentEvent)

  return cli
}

describe('execute', () => {
  const runCLI = async (extraArgs: string[], extraEnv?: Record<string, string>) => {
    const cli = makeCli()
    const context = createMockContext() as any
    process.env = {DD_API_KEY: 'PLACEHOLDER', ...extraEnv}
    context.env = process.env
    const code = await cli.run(['dora', 'deployment', ...extraArgs], context)

    return {context, code}
  }
  describe('dry-run', () => {
    const fakeCurrentDate = new Date(1699960651000)
    beforeAll(() => {
      jest.useFakeTimers()
      jest.setSystemTime(fakeCurrentDate)
    })
    afterAll(() => {
      jest.useRealTimers()
    })
    test('with all parameters provided', async () => {
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--service', 'test-service',
        '--started-at', '1699960648',
        '--finished-at', '1699960650',
        '--env', 'test',
        '--git-repository-url', 'https://github.com/DataDog/datadog-ci',
        '--git-commit-sha', '2186e1b0ab2a87e312a8c831d5bc947fa081d4f9',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).toBe(0)
      checkDryRunConsoleOutput(context.stdout, {
        service: 'test-service',
        startedAt: new Date(1699960648000),
        finishedAt: new Date(1699960650000),
        env: 'test',
        git: {
          repoURL: 'https://github.com/DataDog/datadog-ci',
          commitSHA: '2186e1b0ab2a87e312a8c831d5bc947fa081d4f9',
        },
      })
    })
    test('with minimal parameters provided', async () => {
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--skip-git',
        '--service', 'test-service',
        '--started-at', '1699960648',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).toBe(0)
      checkDryRunConsoleOutput(context.stdout, {
        service: 'test-service',
        startedAt: new Date(1699960648000),
        finishedAt: fakeCurrentDate,
      })
    })
    test('with parameters from env', async () => {
      const envVars = {
        DD_SERVICE: 'different-test-service',
        DD_ENV: 'test-env',
      }
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--skip-git',
        '--started-at', '1699960648',
      ], envVars)
      /* eslint-enable prettier/prettier */
      expect(code).toBe(0)
      checkDryRunConsoleOutput(context.stdout, {
        service: envVars.DD_SERVICE,
        startedAt: new Date(1699960648000),
        finishedAt: fakeCurrentDate,
        env: envVars.DD_ENV,
      })
    })
    test('with automatic git info', async () => {
      const mockGitRepositoryURL = jest.spyOn(gitFunctions, 'gitRepositoryURL')
      const mockGitHash = jest.spyOn(gitFunctions, 'gitHash')
      const gitInfo = {
        repoURL: 'https://github.com/DataDog/datadog-ci',
        commitSHA: '2186e1b0ab2a87e312a8c831d5bc947fa081d4f9',
      }
      mockGitRepositoryURL.mockResolvedValue(gitInfo.repoURL)
      mockGitHash.mockResolvedValue(gitInfo.commitSHA)
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--service', 'test-service',
        '--started-at', '1699960648',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).toBe(0)
      expect(mockGitRepositoryURL).toHaveBeenCalled()
      expect(mockGitHash).toHaveBeenCalled()
      checkDryRunConsoleOutput(context.stdout, {
        service: 'test-service',
        startedAt: new Date(1699960648000),
        finishedAt: fakeCurrentDate,
        git: gitInfo,
      })
    })
    test('service is required', async () => {
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--skip-git',
        '--started-at', '1699960648',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).not.toBe(0)
      expect(context.stdout.toString()).toContain('--service')
    })
    test('started-at is required', async () => {
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--skip-git',
        '--service', 'test-service',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).not.toBe(0)
      expect(context.stdout.toString()).toContain('--started-at')
    })
    test('started-at after finished-at is rejected', async () => {
      /* eslint-disable prettier/prettier */
      // prettier-ignore
      const {context, code} = await runCLI([
        '--dry-run',
        '--skip-git',
        '--service', 'test-service',
        '--started-at', '2099-11-14T11:17:28Z',
      ])
      /* eslint-enable prettier/prettier */
      expect(code).not.toBe(0)
      expect(context.stdout.toString()).toContain('--started-at')
    })
  })
})

const checkDryRunConsoleOutput = (output: any, expectedDeployment: DeploymentEvent) => {
  const text = output.toString()
  expect(text).toContain('DRYRUN')
  expect(text).toContain(JSON.stringify(expectedDeployment, undefined, 2))
}
