import {createCommand, makeRunCLI} from '@datadog/datadog-ci-core/helpers/__tests__/testing-tools'

import {DeploymentMarkCommand} from '../mark'

describe('mark', () => {
  describe('execute', () => {
    const runCLI = makeRunCLI(DeploymentMarkCommand, ['deployment', 'mark'])

    test('should fail if not running in a supported provider', async () => {
      const {context, code} = await runCLI([])
      expect(code).toBe(1)
      expect(context.stdout.toString()).toStrictEqual('')
      expect(context.stderr.toString()).toContain(
        'Only providers [GitHub, GitLab, CircleCI, Buildkite, Jenkins, TeamCity, AzurePipelines] are supported'
      )
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
