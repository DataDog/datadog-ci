import {getCommonAppBaseURL} from '../../helpers/app'

import {APIHelper, EndpointError, formatBackendErrors, getApiHelper} from './api'
import {DeployTestsCommandConfig, LocalTriggerConfig, MainReporter, ServerTest, TestConfig} from './interfaces'
import {findUniqueLocalTestDefinition} from './local-test-definition'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

export const deployTests = async (reporter: MainReporter, config: DeployTestsCommandConfig): Promise<void> => {
  const api = getApiHelper(config)

  reporter.log('Deploying tests...\n\n')

  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }

  if (config.publicIds.length > 0) {
    testConfigFromFile.tests = testConfigFromFile.tests.filter(
      (test) =>
        isLocalTriggerConfig(test) &&
        test.local_test_definition.public_id &&
        config.publicIds.includes(test.local_test_definition.public_id)
    )
  }

  const publicIds = new Set(
    testConfigFromFile.tests.flatMap((test) =>
      isLocalTriggerConfig(test) && test.local_test_definition.public_id ? [test.local_test_definition.public_id] : []
    )
  )

  for (const publicId of publicIds) {
    const test = findUniqueLocalTestDefinition(testConfigFromFile, publicId)

    try {
      await deployLocalTestDefinition(api, test)

      // SYNTH-17840: the edit test endpoint should return a version in the response, so we can print it in the logs and see it in version history
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

  reporter.log(`Deployed local test definitions defined in ${config.files[0]}\n`)
}

const deployLocalTestDefinition = async (api: APIHelper, test: LocalTriggerConfig): Promise<void> => {
  // SYNTH-18434: public ID should be made required
  const publicId = test.local_test_definition.public_id!

  const existingRemoteTest = await api.getTest(publicId)

  // XXX: We should detect noop updates in the backend
  const newRemoteTest = removeUnsupportedEditTestFields({
    ...existingRemoteTest,
    ...test.local_test_definition,
    config: {
      ...existingRemoteTest.config,
      ...test.local_test_definition.config,
    },
    options: {
      ...existingRemoteTest.options,
      ...test.local_test_definition.options,
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
