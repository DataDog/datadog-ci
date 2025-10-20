import fs from 'fs'

import {createCommand, makeRunCLI} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'

import {PluginCommand as DeploymentMarkCommand} from '../commands/mark'

describe('mark', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentMarkCommand, ['deployment', 'mark', '--dry-run'])

    afterEach(() => {
      jest.resetAllMocks()
    })

    test('should fail if not running in a supported provider', async () => {
      const {context, code} = await runCLI([])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toStrictEqual('')
      expect(context.stderr.toString()).toContain(
        'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
      )
    })

    test('all ok', async () => {
      const {context, code} = await runCLI([], {
        DD_BETA_COMMANDS_ENABLED: '1',
        BUILDKITE: 'true',
        BUILDKITE_BUILD_ID: 'id',
        BUILDKITE_JOB_ID: 'id',
      })
      expect(code).toBe(0)
      console.log(context.stdout.toString())
    })

    test('tag command should try to determine github job display name', async () => {
      fs.readdirSync = jest.fn().mockReturnValue([
        {
          name: 'Worker_2.log',
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          parentPath: '',
          path: '',
        },
      ])
      fs.readFileSync = jest.fn().mockReturnValue(`{"jobDisplayName": "real job name"}`)
      const {context, code} = await runCLI([], {
        GITHUB_ACTIONS: 'true',
        GITHUB_SERVER_URL: 'url',
        GITHUB_REPOSITORY: 'repo',
        GITHUB_RUN_ID: '123',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'fake job name',
      })
      expect(code).toBe(0)
      const out = context.stdout.toString()
      expect(out).toContain('Determining github job name')
      expect(out).toContain('"DD_GITHUB_JOB_NAME": "real job name"')
    })
  })

  describe('createDeploymentTags', () => {
    test('should add is rollback if present', () => {
      const command = createCommand(DeploymentMarkCommand)
      command['isRollback'] = true
      const expectedTags = ['datadog_cd_visibility.is_deployment:true', 'datadog_cd_visibility.is_rollback:true']
      expect(command.createJobDeploymentTags()).toEqual(expectedTags)
    })

    test('should add env if present', () => {
      const command = createCommand(DeploymentMarkCommand)
      command['env'] = 'test'
      const expectedTags = ['datadog_cd_visibility.is_deployment:true', 'datadog_cd_visibility.env:test']
      expect(command.createJobDeploymentTags()).toEqual(expectedTags)
    })

    test('should add revision if present', () => {
      const command = createCommand(DeploymentMarkCommand)
      command['revision'] = '1.0.0'
      const expectedTags = ['datadog_cd_visibility.is_deployment:true', 'datadog_cd_visibility.revision:1.0.0']
      expect(command.createJobDeploymentTags()).toEqual(expectedTags)
    })

    test('should add service if present', () => {
      const command = createCommand(DeploymentMarkCommand)
      command['service'] = 'payment-service'
      const expectedTags = ['datadog_cd_visibility.is_deployment:true', 'datadog_cd_visibility.service:payment-service']
      expect(command.createJobDeploymentTags()).toEqual(expectedTags)
    })

    test('should add custom tags if present', () => {
      const command = createCommand(DeploymentMarkCommand)
      command['tags'] = ['team:backend', 'image:my_image']
      const expectedTags = [
        'datadog_cd_visibility.is_deployment:true',
        'datadog_cd_visibility.custom_tags:team:backend,image:my_image',
      ]
      expect(command.createJobDeploymentTags()).toEqual(expectedTags)
    })

    test('should add contains deployment tag to pipeline', () => {
      const command = createCommand(DeploymentMarkCommand)
      const expectedPipelineTags = ['ci.pipeline.contains_deployment:true']
      expect(command.createPipelineDeploymentTags()).toEqual(expectedPipelineTags)
    })
  })
})
