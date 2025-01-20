import {writeFile} from 'fs/promises'

import {getApiHelper} from './api'
import {ImportTestsCommandConfig, LocalTriggerConfig, MainReporter, ServerTest, TestConfig} from './interfaces'
import {getTestConfigs} from './test'

const BASE_FIELDS_TRIM = [
  'created_at',
  'created_by',
  'creator',
  'message',
  'modified_at',
  'modified_by',
  'monitor_id',
  'overall_state',
  'overall_state_modified',
  'status',
  'stepCount',
  'tags',
  'version',
  'version_uuid',
]

const OPTIONS_FIELDS_TRIM = [
  'min_failure_duration',
  'min_location_failed',
  'monitor_name',
  'monitor_options',
  'monitor_priority',
  'tick_every',
]

const CONFIG_FIELDS_TRIM = ['oneClickCreationClassification']

const STEP_FIELDS_TRIM = ['position', 'public_id']

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
      // localTriggerConfig = {local_test_definition: testWithSteps}
      localTriggerConfig = {local_test_definition: removeUnsupportedLTDFields(testWithSteps)}
    } else {
      console.log(test)
      // localTriggerConfig = {local_test_definition: test}
      localTriggerConfig = {local_test_definition: removeUnsupportedLTDFields(test)}
    }
    // TODO remove unsupported fields
    testConfigFromBackend.tests.push(localTriggerConfig)
  }
  // console.log('testConfigFromBackend ', testConfigFromBackend)

  // TODO (answer later) what if there's more than one test file in which the public_ids exist?
  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }
  // console.log('testConfigFromFile ', testConfigFromFile)

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

const removeUnsupportedLTDFields = (testConfig: ServerTest): ServerTest => {
  for (const field of BASE_FIELDS_TRIM) {
    delete testConfig[field as keyof ServerTest]
  }
  for (const field of OPTIONS_FIELDS_TRIM) {
    delete testConfig.options[field as keyof ServerTest['options']]
  }
  for (const field of CONFIG_FIELDS_TRIM) {
    if (field in testConfig.config) {
      delete testConfig.config[field as keyof ServerTest['config']]
    }
  }

  for (const step of testConfig.steps || []) {
    if ('element' in step.params && !!step.params.element) {
      if ('multiLocator' in step.params.element && !!step.params.element.multiLocator) {
        if ('ab' in step.params.element.multiLocator && !!step.params.element.multiLocator.ab) {
          if (!step.params.element.userLocator) {
            step.params.element.userLocator = {
              values: [
                {
                  type: 'xpath',
                  value: step.params.element.multiLocator.ab,
                },
              ],
              failTestOnCannotLocate: true,
            }
          }
          delete step.params.element.multiLocator
        }
        if ('bucketKey' in step.params.element) {
          delete step.params.element['bucketKey']
        }
      }
    }
    for (const field of STEP_FIELDS_TRIM) {
      if (field in step) {
        delete step[field as keyof ServerTest['steps'][0]]
      }
    }
  }

  return testConfig
}
