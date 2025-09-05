import {writeFile} from 'fs/promises'

import {getApiHelper} from './api'
import {ImportTestsCommandConfig, LocalTriggerConfig, MainReporter, TestConfig} from './interfaces'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

export const importTests = async (reporter: MainReporter, config: ImportTestsCommandConfig): Promise<void> => {
  const api = getApiHelper(config)
  reporter.log('Importing tests...\n')
  const testConfigFromBackend: TestConfig = {
    tests: [],
  }

  for (const publicId of config.publicIds) {
    reporter.log(`Fetching test with public_id: ${publicId}\n`)
    let localTriggerConfig: LocalTriggerConfig
    const test = await api.getLocalTestDefinition(publicId)

    if (test?.type === 'browser') {
      const testWithSteps = await api.getLocalTestDefinition(publicId, test.type)
      localTriggerConfig = {localTestDefinition: testWithSteps}
    } else if (test?.type === 'mobile') {
      reporter.error('Unsupported test type: mobile\n')

      return
    } else {
      localTriggerConfig = {localTestDefinition: test}
    }
    testConfigFromBackend.tests.push(localTriggerConfig)
  }

  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }

  const testConfig = overwriteTestConfig(testConfigFromBackend, testConfigFromFile)

  const jsonString = JSON.stringify(testConfig, undefined, 2)
  try {
    await writeFile(config.files[0], jsonString, 'utf8')
    reporter.log(`Local test definition written to ${config.files[0]}\n`)
  } catch (error) {
    reporter.error(`Error writing file: ${error}\n`)
  }
}

const overwriteTestConfig = (testConfigFromBackend: TestConfig, testConfigFromFile: TestConfig): TestConfig => {
  for (const test of testConfigFromBackend.tests) {
    const index = testConfigFromFile.tests.findIndex(
      (t) =>
        isLocalTriggerConfig(t) &&
        isLocalTriggerConfig(test) &&
        t.localTestDefinition?.public_id === test.localTestDefinition?.public_id
    )

    if (index !== -1) {
      testConfigFromFile.tests[index] = test
    } else {
      testConfigFromFile.tests.push(test)
    }
  }

  return testConfigFromFile
}
