import {LocalTriggerConfig, TestConfig} from './interfaces'
import {isLocalTriggerConfig} from './utils/internal'

export const findUniqueLocalTestDefinition = (testConfig: TestConfig, publicId: string): LocalTriggerConfig => {
  const matchingTests = testConfig.tests.flatMap((t) =>
    isLocalTriggerConfig(t) && t.local_test_definition.public_id === publicId ? [t] : []
  )

  if (matchingTests.length > 1) {
    throw new Error(`Cannot have multiple local test definitions with same publicId: ${publicId}.`)
  }

  if (matchingTests.length === 0) {
    throw new Error(`No local test definition found with publicId ${publicId}.`)
  }

  return matchingTests[0]
}
