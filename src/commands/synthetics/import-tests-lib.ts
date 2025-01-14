import {writeFile} from 'fs/promises'

import {getApiHelper} from './api'
import {ImportTestsCommandConfig, LocalTriggerConfig, MainReporter, TestConfig} from './interfaces'
import {getTestConfigs} from './test'

export const importTests = async (reporter: MainReporter, config: ImportTestsCommandConfig) => {
  const api = getApiHelper(config)
  console.log('Importing tests...')
  const testConfigFromBackend: TestConfig = {
    tests: [],
  }

  // TODO (later) fetch public ids from search query if it exists
  for (const publicId of config.publicIds) {
    let localTriggerConfig: LocalTriggerConfig
    const test = await api.getTest(publicId)
    // TODO (answer later) we need the 2nd call because we learn the type from the first one but maybe we can improve in the future
    if (test.type === 'browser' || test.type === 'mobile') {
      console.log('test.type ', test.type)
      const testWithSteps = await api.getTestWithType(publicId, test.type)
      console.log(testWithSteps)
      localTriggerConfig = {local_test_definition: testWithSteps}
    } else {
      console.log(test)
      localTriggerConfig = {local_test_definition: test}
    }
    testConfigFromBackend.tests.push(localTriggerConfig)
  }
  // console.log('testConfigFromBackend ', testConfigFromBackend)

  // TODO get steps

  // TODO (answer later) what if there's more than one test file in which the public_ids exist?
  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }
  // console.log('testConfigFromFile ', testConfigFromFile)
  // TODO remove unsupported fields

  const testConfig = overwriteTestConfig(testConfigFromBackend, testConfigFromFile)
  // console.log('testConfig ', testConfig)

  // eslint-disable-next-line no-null/no-null
  const jsonString = JSON.stringify(testConfig, null, 2)
  try {
    await writeFile(config.files[0], jsonString, 'utf8')
    console.log(`Object has been written to ${config.files[0]}`)
  } catch (error) {
    console.error('Error writing file:', error)
  }
}
const overwriteTestConfig = (testConfig: TestConfig, testConfigFromFile: TestConfig): TestConfig => {
  for (const test of testConfig.tests) {
    // TODO (answer later) what if there's more than 1 test with this public_id?
    const index = testConfigFromFile.tests.findIndex(
      (t) => t.local_test_definition.public_id === test.local_test_definition.public_id
    )

    if (index !== -1) {
      // TODO (answer later) we can maybe ask the user here if they are sure they want to override the test or extend it
      testConfigFromFile.tests[index] = testConfig.tests[index]
    } else {
      testConfigFromFile.tests.push(test)
    }
  }

  return testConfigFromFile
}
