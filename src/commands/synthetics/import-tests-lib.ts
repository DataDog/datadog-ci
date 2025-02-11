import {writeFile} from 'fs/promises'

import {getApiHelper} from './api'
import {
  ImportTestsCommandConfig,
  LocalTriggerConfig,
  MainReporter,
  ServerTest,
  TestConfig,
  TestStepWithUnsupportedFields,
} from './interfaces'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

const BASE_FIELDS_TRIM: (keyof ServerTest)[] = [
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

const OPTIONS_FIELDS_TRIM: (keyof ServerTest['options'])[] = [
  'min_failure_duration',
  'min_location_failed',
  'monitor_name',
  'monitor_options',
  'monitor_priority',
  'tick_every',
]

const STEP_FIELDS_TRIM: (keyof TestStepWithUnsupportedFields)[] = ['public_id']

export const importTests = async (reporter: MainReporter, config: ImportTestsCommandConfig): Promise<void> => {
  const api = getApiHelper(config)
  reporter.log('Importing tests...\n')
  const testConfigFromBackend: TestConfig = {
    tests: [],
  }

  for (const publicId of config.publicIds) {
    reporter.log(`Fetching test with public_id: ${publicId}\n`)
    let localTriggerConfig: LocalTriggerConfig
    const test = await api.getTest(publicId)

    if (test.type === 'browser') {
      const testWithSteps = await api.getTestWithType(publicId, test.type)
      localTriggerConfig = {local_test_definition: removeUnsupportedLTDFields(testWithSteps)}
    } else if (test.type === 'mobile') {
      reporter.error('Unsupported test type: mobile\n')

      return
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
    reporter.log(`Object has been written to ${config.files[0]}\n`)
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
    delete testConfig[field]
  }
  for (const field of OPTIONS_FIELDS_TRIM) {
    delete testConfig.options[field]
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
        delete step[field]
      }
    }
  }

  return testConfig
}
