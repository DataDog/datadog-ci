import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'
import {TunnelInfo} from './tunnel'

export interface MainReporter {
  error(error: string): void
  initErrors(errors: string[]): void
  log(log: string): void
  reportStart(timings: {startTime: number}): void
  resultEnd(result: Result, baseUrl: string): void
  resultReceived(result: Batch['results'][0]): void
  runEnd(summary: Summary, baseUrl: string): void
  testsWait(tests: Test[]): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: ConfigOverride): void
  testWait(test: Test): void
}

export type Reporter = Partial<MainReporter>

export interface BaseServerResult {
  failure?: {
    code: string
    message: string
  }
  passed: boolean
  unhealthy?: boolean
}

export interface BrowserServerResult extends BaseServerResult {
  device: {
    height: number
    id: string
    width: number
  }
  duration: number
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

export interface PollResult {
  check: Pick<Test, 'config' | 'subtype' | 'type'>
  result: ServerResult
  resultID: string
  timestamp: number
}

export interface Result {
  executionRule: ExecutionRule
  location: string
  // `.passed` here combines `result.passed` and `failOnCriticalErrors` and `failOnTimeout`
  passed: boolean
  result: ServerResult
  resultId: string
  // Original test for this result, including overrides if any.
  test: Test
  timedOut: boolean
  timestamp: number
}

type Status = 'passed' | 'failed' | 'in_progress'

export interface ResultInBatch {
  execution_rule: ExecutionRule
  location: string
  result_id: string
  status: Status
  test_public_id: string
  timed_out?: boolean
}

export interface Batch {
  results: ResultInBatch[]
  status: Status
}

interface SkippedResultInBatch extends Omit<ResultInBatch, 'result_id' | 'status'> {
  status: 'skipped'
}
type ServerResultInBatch = SkippedResultInBatch | ResultInBatch

export interface ServerBatch {
  // The batch from the server contains skipped results, which we're going to remove since we don't
  // care about skipped results internally.
  results: ServerResultInBatch[]
  status: Status
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
  mobileApplication?: {
    created_at: string
    description: string
    id: string
    name: string
    platform: 'ios' | 'android'
    tags: string[]
  }
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

export interface Location {
  display_name: string
  id: number
  is_active: boolean
  name: string
  region: string
}

export interface LocationsMapping {
  [key: string]: string
}

export interface Trigger {
  batch_id: string
  locations: Location[]
}

export interface RetryConfig {
  count: number
  interval: number
}

export interface ConfigOverride {
  allowInsecureCertificates?: boolean
  applicationId?: string
  applicationVersionId?: string
  basicAuth?: BasicAuthCredentials
  body?: string
  bodyType?: string
  cookies?: string | {append?: boolean; value: string}
  defaultStepTimeout?: number
  deviceIds?: string[]
  executionRule?: ExecutionRule
  fileName?: string
  followRedirects?: boolean
  headers?: {[key: string]: string}
  locations?: string[]
  mobileAndroidApplicationVersion?: string
  mobileAndroidApplicationVersionFilePath?: string
  mobileIOSApplicationVersion?: string
  mobileIOSApplicationVersionFilePath?: string
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
  // The batchId is set later in the process, so it first needs to be undefined ; it will always be defined eventually.
  // Multiple suites will have the same batchId.
  batchId?: string
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
