import {getCommonAppBaseURL} from '../../helpers/app'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper} from './api'
import {DeployTestsCommandConfig, LocalTriggerConfig, MainReporter, ServerTest} from './interfaces'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

export const deployTests = async (reporter: MainReporter, config: DeployTestsCommandConfig): Promise<void> => {
  const api = getApiHelper(config)

  reporter.log('Deploying tests...\n\n')

  const triggerConfigs = await getTestConfigs(config, reporter)
  const localTestDefinitionsToDeploy = triggerConfigs.flatMap((triggerConfig) => {
    if (!isLocalTriggerConfig(triggerConfig)) {
      return []
    }

    if (!triggerConfig.localTestDefinition.public_id) {
      throw new Error('Local test definition is missing a public_id')
    }

    if (config.publicIds.length > 0 && !config.publicIds.includes(triggerConfig.localTestDefinition.public_id)) {
      return []
    }

    return [triggerConfig]
  })

  for (const localTestDefinition of localTestDefinitionsToDeploy) {
    // SYNTH-18434: public ID should be made required
    const publicId = localTestDefinition.localTestDefinition.public_id!

    try {
      await deployLocalTestDefinition(api, localTestDefinition)

      // SYNTH-18527: the edit test endpoint should return a version in the response, so we can print it in the logs and see it in version history
      const baseUrl = getCommonAppBaseURL(config.datadogSite, config.subdomain)
      const testLink = `${baseUrl}synthetics/details/${publicId}`

      reporter.log(`New version successfully deployed for main test definition ${publicId}:\n  ⎋ ${testLink}\n\n`)
    } catch (e) {
      const errorMessage = formatBackendErrors(e)
      throw new EndpointError(
        `[${publicId}] Failed to update main test definition: ${errorMessage}\n`,
        e.response?.status
      )
    }
  }
}

const deployLocalTestDefinition = async (api: APIHelper, test: LocalTriggerConfig): Promise<void> => {
  // SYNTH-18434: public ID should be made required
  const publicId = test.localTestDefinition.public_id!

  const existingRemoteTest = await api.getTest(publicId)

  // SYNTH-18528: the client should not have to handle the merge for partial update
  const newRemoteTest = removeUnsupportedEditTestFields({
    ...existingRemoteTest,
    ...test.localTestDefinition,
    config: {
      ...existingRemoteTest.config,
      ...test.localTestDefinition.config,
    },
    options: {
      ...existingRemoteTest.options,
      ...test.localTestDefinition.options,
    },
  })

  await api.editTest(publicId, newRemoteTest)
}

const removeUnsupportedEditTestFields = (testConfig: ServerTest): ServerTest => {
  const editTestPayload = {...testConfig} as Partial<ServerTest>
  delete editTestPayload.creator
  delete editTestPayload.monitor_id
  delete editTestPayload.created_at
  delete editTestPayload.modified_at
  delete editTestPayload.public_id

  // Only remove bindings if they are null to make validation happy
  if (editTestPayload.options && !editTestPayload.options.bindings) {
    delete editTestPayload.options.bindings
  }

  return editTestPayload as ServerTest
}
