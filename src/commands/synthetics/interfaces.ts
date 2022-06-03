import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'
import {TunnelInfo} from './tunnel'

export interface MainReporter {
  error(error: string): void
  initErrors(errors: string[]): void
  log(log: string): void
  reportStart(timings: {startTime: number}): void
  runEnd(summary: Summary): void
  // `testEnd` is called for each result
  testEnd(test: Test, results: Result[], baseUrl: string, locationNames: LocationsMapping): void
  testResult(triggerResponse: TriggerResponse, result: Result): void
  testsWait(tests: Test[]): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: ConfigOverride): void
  testWait(test: Test): void
}

export enum ERRORS {
  TIMEOUT = 'Timeout',
  ENDPOINT = 'Endpoint Failure',
  TUNNEL = 'Tunnel Failure',
}

export type Reporter = Partial<MainReporter>

export interface BaseServerResult {
  error?: string
  errorCode?: string
  errorMessage?: string
  eventType: string
  failure?: {
    code: string
    message: string
  }
  passed: boolean
  tunnel?: boolean
  unhealthy?: boolean
}

export interface BrowserServerResult extends BaseServerResult {
  device: {
    height: number
    id: string
    width: number
  }
  duration: number
  error?: string | ERRORS
  startUrl: string
  stepDetails: Step[]
}

interface AssertionResult {
  actual: any
  expected?: any
  valid: boolean
}

export interface ApiServerResult extends BaseServerResult {
  assertionResults: AssertionResult[]
  timings: {
    total: number
  }
}

export interface MultiStep {
  allowFailure: boolean
  assertionResults: AssertionResult[]
  failure?: {
    code: string
    message: string
  }
  name: string
  passed: boolean
  skipped: boolean
  subtype: string
  timings: {
    total: number
  }
}

export interface MultiStepsServerResult extends BaseServerResult {
  duration: number
  steps: MultiStep[]
}

export type ServerResult = BrowserServerResult | ApiServerResult | MultiStepsServerResult

interface Enrichment {
  batch_id: string
  config_override: ConfigOverride & {executionRule: ExecutionRule}
}

export interface PollResult {
  check: Pick<Test, 'config' | 'subtype' | 'type'>
  dc_id: number
  enrichment?: Partial<Enrichment>
  result: ServerResult
  resultID: string
  timestamp: number
}

export interface Result {
  dcId: number
  enrichment?: Partial<Enrichment>
  // `.passed` here combines `result.passed` and `failOnCriticalErrors` and `failOnTimeout`
  passed: boolean
  result: ServerResult
  resultId: string
  // Original test for this result, including overrides if any.
  test: Test
  timestamp: number
}

export interface Vitals {
  cls?: number
  lcp?: number
  url: string
}

export interface BrowserError {
  description: string
  name: string
  type: string
}

export interface Step {
  allowFailure: boolean
  browserErrors: BrowserError[]
  description: string
  duration: number
  error?: string
  publicId?: string
  skipped: boolean
  stepId: number
  subTestPublicId?: string
  subTestStepDetails?: Step[]
  type: string
  url: string
  value?: string | number
  vitalsMetrics: Vitals[]
  warnings?: {
    message: string
    type: string
  }[]
}

export interface ServerTest {
  config: {
    assertions: Assertion[]
    request: {
      dnsServer?: string
      headers: {[key: string]: string}
      host?: string
      method: string
      port?: number
      timeout: number
      url: string
    }
    steps?: {subtype: string}[]
    variables: string[]
  }
  created_at: string
  created_by: User
  locations: string[]
  message: string
  modified_at: string
  modified_by: User
  monitor_id: number
  name: string
  options: {
    ci?: {
      executionRule: ExecutionRule
    }
    device_ids?: string[]
    min_failure_duration: number
    min_location_failed: number
    tick_every: number
  }
  overall_state: number
  overall_state_modified: string
  public_id: string
  status: string
  stepCount: number
  subtype: string
  tags: string[]
  type: string
}

export interface Test extends ServerTest {
  suite?: string
}

export interface Assertion {
  actual: string | number | Date | {[key: string]: any}
  errorMessage?: string
  operator: Operator
  property?: string
  target: string | number | Date | {[key: string]: any}
  type: string
  valid: boolean
}

export enum Operator {
  contains = 'contains',
  doesNotContain = 'doesNotContain',
  is = 'is',
  isNot = 'isNot',
  isInLessThan = 'isInLessThan',
  isInMoreThan = 'isInMoreThan',
  lessThan = 'lessThan',
  lessThanOrEqual = 'lessThanOrEqual',
  moreThan = 'moreThan',
  moreThanOrEqual = 'moreThanOrEqual',
  matches = 'matches',
  doesNotMatch = 'doesNotMatch',
  validatesJSONPath = 'validatesJSONPath',
  validatesXPath = 'validatesXPath',
}

export interface User {
  email: string
  handle: string
  id: number
  name: string
}

export interface TriggerResponse {
  device: string
  location: number
  public_id: string
  result_id: string
}

export interface TriggerResult extends TriggerResponse {
  pollingTimeout: number
}

export interface Location {
  display_name: string
  id: number
  is_active: boolean
  name: string
  region: string
}

export interface LocationsMapping {
  [key: number]: string
}

export interface Trigger {
  locations: Location[]
  results: TriggerResponse[]
}

export interface RetryConfig {
  count: number
  interval: number
}

export interface ConfigOverride {
  allowInsecureCertificates?: boolean
  basicAuth?: BasicAuthCredentials
  body?: string
  bodyType?: string
  cookies?: string | {append?: boolean; value: string}
  defaultStepTimeout?: number
  deviceIds?: string[]
  executionRule?: ExecutionRule
  followRedirects?: boolean
  headers?: {[key: string]: string}
  locations?: string[]
  pollingTimeout?: number
  retry?: RetryConfig
  startUrl?: string
  startUrlSubstitutionRegex?: string
  tunnel?: TunnelInfo
  variables?: {[key: string]: string}
}

export interface Payload {
  metadata?: Metadata
  tests: TestPayload[]
}

export interface TestPayload extends ConfigOverride {
  executionRule: ExecutionRule
  public_id: string
}

export interface BasicAuthCredentials {
  password: string
  username: string
}

export interface TemplateVariables {
  DOMAIN?: string
  HASH?: string
  HOST?: string
  HOSTNAME?: string
  ORIGIN?: string
  PARAMS?: string
  PATHNAME?: string
  PORT?: string
  PROTOCOL?: string
  SUBDOMAIN?: string
  URL: string
}

export interface TemplateContext extends TemplateVariables, NodeJS.ProcessEnv {}

export interface TriggerConfig {
  config: ConfigOverride
  id: string
  suite?: string
}

export enum ExecutionRule {
  BLOCKING = 'blocking',
  NON_BLOCKING = 'non_blocking',
  SKIPPED = 'skipped',
}

export interface Suite {
  content: {
    tests: TriggerConfig[]
  }
  name?: string
}

export interface Summary {
  criticalErrors: number
  failed: number
  failedNonBlocking: number
  passed: number
  skipped: number
  testsNotFound: Set<string>
  timedOut: number
}

export interface TestSearchResult {
  tests: {
    public_id: string
  }[]
}

export interface APIConfiguration {
  apiKey: string
  appKey: string
  baseIntakeUrl: string
  baseUrl: string
  proxyOpts: ProxyConfiguration
}

export interface SyntheticsCIConfig {
  apiKey: string
  appKey: string
  configPath: string
  datadogSite: string
  failOnCriticalErrors: boolean
  files: string[]
  global: ConfigOverride
  locations: string[]
  pollingTimeout: number
  proxy: ProxyConfiguration
  publicIds: string[]
  subdomain: string
  testSearchQuery?: string
  tunnel: boolean
  variableStrings: string[]
}

export interface CommandConfig extends SyntheticsCIConfig {
  failOnTimeout: boolean
}
