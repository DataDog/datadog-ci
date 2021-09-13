import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'
import {TunnelInfo} from './tunnel'

interface Timings {
  dns: number
  download: number
  firstByte: number
  ssl: number
  tcp: number
  total: number
}

export interface MainReporter {
  error(error: string): void
  initErrors(errors: string[]): void
  log(log: string): void
  reportStart(timings: {startTime: number}): void
  runEnd(summary: Summary): void
  testEnd(
    test: Test,
    results: PollResult[],
    baseUrl: string,
    locationNames: LocationsMapping,
    failOnCriticalErrors: boolean,
    failOnTimeout: boolean
  ): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: ConfigOverride): void
  testWait(test: Test): void
}

export type Reporter = Partial<MainReporter>

export interface Result {
  device: {
    id: string
  }
  duration?: number
  error?: string | 'Endpoint Failure' | 'Timeout' | 'Tunnel Failure'
  errorCode?: string
  errorMessage?: string
  eventType: string
  failure?: {
    code: string
    message: string
  }
  passed: boolean
  stepDetails: Step[]
  timings?: Timings
  tunnel?: boolean
  unhealthy?: boolean
}

export interface PollResult {
  check?: Test
  dc_id: number
  result: Result
  resultID: string
}

interface Resource {
  duration: number
  size: number
  type: string
  url: string
}

export interface Step {
  apmTraceIds: string[]
  browserErrors: string[]
  description: string
  duration: number
  error?: string
  resource: Resource
  screenshotBucketKey: boolean
  skipped: boolean
  snapshotBucketKey: boolean
  stepId: number
  type: string
  url: string
  value: string
}

export interface Test {
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
    device_ids: string[]
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
  lessThan = 'lessThan',
  matches = 'matches',
  doesNotMatch = 'doesNotMatch',
  validates = 'validates',
  isInMoreThan = 'isInMoreThan',
  isInLessThan = 'isInLessThan',
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
  result?: PollResult
}

interface Location {
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
  triggered_check_ids: string[]
}

interface RetryConfig {
  count: number
  interval: number
}

export interface ConfigOverride {
  allowInsecureCertificates?: boolean
  basicAuth?: BasicAuthCredentials
  body?: string
  bodyType?: string
  cookies?: string
  defaultStepTimeout?: number
  deviceIds?: string[]
  executionRule?: ExecutionRule
  followRedirects?: boolean
  headers?: {[key: string]: string}
  locations?: string[]
  pollingTimeout?: number
  retry?: RetryConfig
  startUrl?: string
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

interface BasicAuthCredentials {
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
}

export enum ExecutionRule {
  BLOCKING = 'blocking',
  NON_BLOCKING = 'non_blocking',
  SKIPPED = 'skipped',
}

export interface Suite {
  tests: TriggerConfig[]
}

export interface Summary {
  criticalErrors: number
  failed: number
  notFound: number
  passed: number
  skipped: number
  timedOut: number
}

export interface TestSearchResult {
  tests: {
    public_id: string
  }[]
}

export interface APIHelper {
  getPresignedURL(testIds: string[]): Promise<{url: string}>
  getTest(testId: string): Promise<Test>
  pollResults(resultIds: string[]): Promise<{results: PollResult[]}>
  searchTests(query: string): Promise<TestSearchResult>
  triggerTests(payload: Payload): Promise<Trigger>
}

export interface APIConfiguration {
  apiKey: string
  appKey: string
  baseIntakeUrl: string
  baseUrl: string
  proxyOpts: ProxyConfiguration
}

export interface CommandConfig {
  apiKey: string
  appKey: string
  configPath: string
  datadogSite: string
  failOnCriticalErrors: boolean
  failOnTimeout: boolean
  files: string[]
  global: ConfigOverride
  pollingTimeout: number
  proxy: ProxyConfiguration
  publicIds: string[]
  subdomain: string
  testSearchQuery?: string
  tunnel: boolean
}
