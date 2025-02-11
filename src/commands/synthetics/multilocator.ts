import {writeFile} from 'fs/promises'

import inquirer from 'inquirer'

import {
  Result,
  BaseResult,
  MultiLocator,
  ServerResult,
  BrowserServerResult,
  TestConfig,
  ImportTestsCommandConfig,
  MainReporter,
} from './interfaces'
import {ICONS} from './reporters/constants'
import {getTestConfigs} from './test'
import {isLocalTriggerConfig} from './utils/internal'

type MultiLocatorMap = {[key: string]: (MultiLocator | undefined)[]}

export const updateLTDMultiLocators = async (
  reporter: MainReporter,
  config: ImportTestsCommandConfig,
  results: Result[]
) => {
  reporter.log('Checking for MultiLocator updates...\r')
  const multiLocatorMap = getMultiLocatorsFromResults(results)

  const hasMLUpdates = Object.values(multiLocatorMap).some((steps) => steps.some((ml) => ml !== undefined))

  if (!hasMLUpdates) {
    return reporter.log('No MultiLocator updates found. No changes will be made.\n')
  }

  const userConfirmed = await promptUser(
    'MultiLocator updates found. Do you want to apply them to your local test definition?'
  )
  if (!userConfirmed) {
    return reporter.log('\nMultilocator updates aborted by user.\n')
  }

  reporter.log('\nApplying MultiLocator updates...\n\n')
  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }

  const testConfig = overwriteMultiLocatorsInTestConfig(multiLocatorMap, testConfigFromFile)

  try {
    // eslint-disable-next-line no-null/no-null
    await writeFile(config.files[0], JSON.stringify(testConfig, null, 2), 'utf8')
    reporter.log(`${ICONS.SUCCESS} Multilocator updates have been successfully applied in ${config.files[0]}\n`)
  } catch (error) {
    reporter.error(`${ICONS.FAILED} Error writing file: ${error}\n`)
  }
}

export const getMultiLocatorsFromResults = (results: Result[]): MultiLocatorMap => {
  const multiLocatorMap: MultiLocatorMap = {}

  for (const result of results) {
    const publicId = result.test.public_id
    if (publicId === undefined) {
      continue
    }

    const stepMLUpdates: (MultiLocator | undefined)[] = []

    if (isBaseResult(result) && result.result && isBrowserServerResult(result.result)) {
      const steps = result.result.stepDetails.slice(1) // Skip first step (navigation)
      for (const step of steps) {
        const multiLocator = step.stepElementUpdates?.multiLocator
        stepMLUpdates.push(multiLocator)
      }
    }

    if (stepMLUpdates.some((ml) => ml !== undefined)) {
      multiLocatorMap[publicId] = stepMLUpdates
    }
  }

  return multiLocatorMap
}

const isBaseResult = (result: Result): result is BaseResult => {
  return (result as BaseResult).result !== undefined
}

const isBrowserServerResult = (result: ServerResult): result is BrowserServerResult => {
  return (result as BrowserServerResult).stepDetails !== undefined
}

export const promptUser = async (message: string): Promise<boolean> => {
  const question: inquirer.ConfirmQuestion<{confirm: boolean}> = {
    type: 'confirm',
    name: 'confirm',
    message,
    default: false,
  }
  const {confirm} = await inquirer.prompt([question])

  return confirm
}

const overwriteMultiLocatorsInTestConfig = (
  multiLocatorMap: MultiLocatorMap,
  testConfigFromFile: TestConfig
): TestConfig => {
  for (const publicId of Object.keys(multiLocatorMap)) {
    const index = testConfigFromFile.tests.findIndex(
      (t) => isLocalTriggerConfig(t) && t.local_test_definition.public_id === publicId
    )

    if (index !== -1) {
      const test = testConfigFromFile.tests[index]
      if (isLocalTriggerConfig(test) && test.local_test_definition.steps) {
        const steps = test.local_test_definition.steps || []
        for (const [stepIndex, step] of steps.entries()) {
          const multiLocator = multiLocatorMap[publicId][stepIndex]
          if (multiLocator) {
            if (step.params.element === undefined) {
              throw new Error(`[Multilocator Update] Step ${stepIndex} in test ${publicId} does not have an element`)
            }
            step.params.element.multiLocator = multiLocator
          }
        }
      }
    } else {
      throw new Error(`[Multilocator Update] Could not find test with publicId ${publicId} in the local test config`)
    }
  }

  return testConfigFromFile
}
