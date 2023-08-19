import type {RunTestsCommandConfig} from './interfaces'

export const MAX_TESTS_TO_TRIGGER = 100

export const DEFAULT_POLLING_TIMEOUT = 30 * 60 * 1000

export const DEFAULT_COMMAND_CONFIG: RunTestsCommandConfig = {
  apiKey: '',
  appKey: '',
  configPath: 'datadog-ci.json',
  datadogSite: 'datadoghq.com',
  failOnCriticalErrors: false,
  failOnMissingTests: false,
  failOnTimeout: true,
  files: ['{,!(node_modules)/**/}*.synthetics.json'],
  global: {},
  locations: [],
  pollingTimeout: DEFAULT_POLLING_TIMEOUT,
  proxy: {protocol: 'http'},
  publicIds: [],
  subdomain: 'app',
  tunnel: false,
  variableStrings: [],
}
