import {writeFile} from 'fs/promises'

import {isInteractive} from '../../helpers/ci'
import {requestConfirmation} from '../../helpers/prompt'

import {Result, MultiLocator, TestConfig, ImportTestsCommandConfig, MainReporter, Step} from './interfaces'
import {findUniqueLocalTestDefinition} from './local-test-definition'
import {ICONS} from './reporters/constants'
import {getTestConfigs} from './test'
import {hasDefinedResult, isBrowserServerResult} from './utils/internal'

type MultiLocatorMap = {[publicId: string]: (MultiLocator | undefined)[]}

export const updateLTDMultiLocators = async (
  reporter: MainReporter,
  config: ImportTestsCommandConfig,
  results: Result[]
) => {
  reporter.log('Checking for MultiLocator updates...\r') // replaced by next log
  const multiLocatorMap = getMultiLocatorsFromResults(results)

  const hasMLUpdates = Object.values(multiLocatorMap).some((steps) => steps.some((ml) => ml !== undefined))

  if (!hasMLUpdates) {
    return reporter.log('No MultiLocator updates found. No changes will be made.\n')
  }

  if (!isInteractive()) {
    return reporter.log('MultiLocator updates found, but cannot apply them in non-interactive mode.\n')
  }

  const userConfirmed = await requestConfirmation(
    'MultiLocator updates found. Do you want to apply them to your local test definition?',
    false
  )
  if (!userConfirmed) {
    return reporter.log('\nMultiLocator updates aborted by user.\n')
  }

  reporter.log('\nApplying MultiLocator updates...\n\n')
  const testConfigFromFile: TestConfig = {
    tests: await getTestConfigs(config, reporter),
  }

  const testConfig = overwriteMultiLocatorsInTestConfig(multiLocatorMap, testConfigFromFile)

  try {
    await writeFile(config.files[0], JSON.stringify(testConfig, undefined, 2), 'utf8')
    reporter.log(`${ICONS.SUCCESS} MultiLocator updates have been successfully applied in ${config.files[0]}\n`)
  } catch (error) {
    reporter.error(`${ICONS.FAILED} Error writing to file: ${error}\n`)
  }
}

const getMultiLocatorsFromResults = (results: Result[]): MultiLocatorMap => {
  const multiLocatorMap: MultiLocatorMap = {}

  for (const result of results) {
    const publicId = result.test.public_id
    if (publicId === undefined) {
      continue
    }

    const stepMLUpdates: (MultiLocator | undefined)[] = []

    if (hasDefinedResult(result) && result.result && isBrowserServerResult(result.result)) {
      const steps = result.result.steps.slice(1) as Step[] // Skip first step (navigation)
      for (const step of steps) {
        const multiLocator = step.element_updates?.multi_locator
        stepMLUpdates.push(multiLocator)
      }
    }

    if (stepMLUpdates.some((ml) => ml !== undefined)) {
      multiLocatorMap[publicId] = stepMLUpdates
    }
  }

  return multiLocatorMap
}

const overwriteMultiLocatorsInTestConfig = (
  multiLocatorMap: MultiLocatorMap,
  testConfigFromFile: TestConfig
): TestConfig => {
  for (const publicId of Object.keys(multiLocatorMap)) {
    const test = findUniqueLocalTestDefinition(testConfigFromFile, publicId)

    if (test && test.localTestDefinition.steps) {
      const steps = test.localTestDefinition.steps
      for (const [stepIndex, step] of steps.entries()) {
        const multiLocator = multiLocatorMap[publicId][stepIndex]
        if (multiLocator) {
          if (!step.params.element) {
            step.params.element = {}
          }
          step.params.element.multiLocator = multiLocator
        }
      }
    }
  }

  return testConfigFromFile
}
