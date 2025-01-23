import {writeFile} from 'fs/promises'

import {getApiHelper} from './api'
import {
  ImportTestsCommandConfig,
  LocalTriggerConfig,
  MainReporter,
  ServerTest,
  TestConfig,
  TestStep,
} from './interfaces'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

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

export const importTests = async (reporter: MainReporter, config: ImportTestsCommandConfig): Promise<void> => {
  const api = getApiHelper(config)
  console.log('Importing tests...')
  const testConfigFromBackend: TestConfig = {
    tests: [],
  }

  for (const publicId of config.publicIds) {
    console.log(`Fetching test with public_id: ${publicId}`)
    let localTriggerConfig: LocalTriggerConfig
    const test = await api.getTest(publicId)

    if (test.type === 'browser' || test.type === 'mobile') {
      const testWithSteps = await api.getTestWithType(publicId, test.type)
      localTriggerConfig = {local_test_definition: removeUnsupportedLTDFields(testWithSteps)}
    } else {
      localTriggerConfig = {local_test_definition: removeUnsupportedLTDFields(test)}
    }
    testConfigFromBackend.tests.push(localTriggerConfig)
  }

  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }

  const testConfig = overwriteTestConfig(testConfigFromBackend, testConfigFromFile)

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
    const index = testConfigFromFile.tests.findIndex(
      (t) =>
        isLocalTriggerConfig(t) &&
        isLocalTriggerConfig(test) &&
        t.local_test_definition.public_id === test.local_test_definition.public_id
    )

    if (index !== -1) {
      testConfigFromFile.tests[index] = test
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
        delete step[field as keyof TestStep]
      }
    }
  }

  return testConfig
}
