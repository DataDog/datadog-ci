interface Timings {
  dns: number
  download: number
  firstByte: number
  ssl: number
  tcp: number
  total: number
}

export interface Result {
  device: {
    id: string
  }
  duration?: number
  error?: string
  errorCode?: string
  errorMessage?: string
  eventType: string
  passed: boolean
  stepDetails: Step[]
  timings?: Timings
  unhealthy?: boolean
}

export interface PollResult {
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
      headers: {[key: string]: string}
      method: string
      timeout: number
      url: string
    }
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

interface User {
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
  deviceIds?: string[]
  executionRule?: ExecutionRule
  followRedirects?: boolean
  headers?: {[key: string]: string}
  locations?: string[]
  pollingTimeout?: number
  retry?: RetryConfig
  startUrl?: string
  variables?: {[key: string]: string}
}

export interface Metadata {
  ci?: {
    pipeline?: {
      url?: string
    }
    provider?: {
      name: string
    }
  }
  git?: {
    branch?: string
    commit_sha?: string
  }
}

export interface Payload extends ConfigOverride {
  metadata?: Metadata
  public_id: string
}

interface BasicAuthCredentials {
  password: string
  username: string
}

export interface TemplateContext extends NodeJS.ProcessEnv {
  DOMAIN: string
  HOST: string
  HOSTNAME: string
  ORIGIN: string
  PARAMS: string
  PATHNAME: string
  PORT: string
  PROTOCOL: string
  SUBDOMAIN: string | undefined
  URL: string
}

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

export interface TestSearchResult {
  tests: {
    public_id: string
  }[]
}

export interface APIHelper {
  getTest(testId: string): Promise<Test>
  pollResults(resultIds: string[]): Promise<{results: PollResult[]}>
  searchTests(query: string): Promise<TestSearchResult>
  triggerTests(testsToTrigger: Payload[]): Promise<Trigger>
}

export type ProxyType =
  | 'http'
  | 'https'
  | 'socks'
  | 'socks4'
  | 'socks4a'
  | 'socks5'
  | 'socks5h'
  | 'pac+data'
  | 'pac+file'
  | 'pac+ftp'
  | 'pac+http'
  | 'pac+https'

export interface ProxyConfiguration {
  auth?: {
    password: string
    username: string
  }
  host?: string
  port?: number
  protocol: ProxyType
}

export interface APIConfiguration {
  apiKey: string
  appKey: string
  baseIntakeUrl: string
  baseUrl: string
  proxyOpts: ProxyConfiguration
}
