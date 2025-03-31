import {getDefaultConfig} from './run-tests-lib'

export {CiError, CriticalError} from './errors'
export * from './interfaces'
export {DefaultReporter} from './reporters/default'
export {JUnitReporter} from './reporters/junit'
export {executeTests, execute} from './run-tests-lib'
export * as utils from './utils/public'

export const DEFAULT_COMMAND_CONFIG = getDefaultConfig()
