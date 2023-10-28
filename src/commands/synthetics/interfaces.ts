import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'

import {TunnelInfo} from './tunnel'

export type SupportedReporter = 'junit' | 'default'

export interface MainReporter {
  error(error: string): void
  initErrors(errors: string[]): void
  log(log: string): void
  reportStart(timings: {startTime: number}): void
  resultEnd(result: Result, baseUrl: string): void
  resultReceived(result: Batch['results'][0]): void
  runEnd(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings): void
  testsWait(tests: Test[], baseUrl: string, batchId: string): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride): void
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

export interface Device {
  height: number
  id: string
  width: number
}

export interface BrowserServerResult extends BaseServerResult {
  device?: Device
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

export type PollResultMap = {[resultId: string]: PollResult}

/**
 * Information required to convert a `PollResult` to a `Result`.
 */
export type ResultDisplayInfo = {
  getLocation: (datacenterId: string, test: Test) => string
  options: {
    datadogSite: string
    failOnCriticalErrors?: boolean
    failOnTimeout?: boolean
    maxPollingTimeout: number
    subdomain: string
  }
  tests: Test[]
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
    mobileApplication?: MobileApplication
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

export interface MobileApplication {
  applicationId: string
  referenceId: string
  referenceType: 'latest' | 'version' | 'temporary'
}

export interface BaseConfigOverride {
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
  resourceUrlSubstitutionRegexes?: string[]
  retry?: RetryConfig
  startUrl?: string
  startUrlSubstitutionRegex?: string
  testTimeout?: number
  tunnel?: TunnelInfo
  variables?: {[key: string]: string}
}

export interface UserConfigOverride extends BaseConfigOverride {
  mobileApplicationVersion?: string
  mobileApplicationVersionFilePath?: string
}

export interface ServerConfigOverride extends BaseConfigOverride {
  mobileApplication?: MobileApplication
}

export interface BatchOptions {
  selective_rerun?: boolean
}

export interface Payload {
  metadata?: Metadata
  tests: TestPayload[]
  options?: BatchOptions
}

export interface TestPayload extends ServerConfigOverride {
  executionRule: ExecutionRule
  public_id: string
}

export interface BasicAuthCredentials {
  password: string
  username: string
}
export interface TriggerConfig {
  config: UserConfigOverride
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
  // The batchId is associated to a full run of datadog-ci: multiple suites will be in the same batch.
  batchId: string
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
  baseUnstableUrl: string
  baseUrl: string
  proxyOpts: ProxyConfiguration
}

export interface APIHelperConfig {
  apiKey: string
  appKey: string
  datadogSite: string
  proxy: ProxyConfiguration
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SyntheticsCIConfig extends APIHelperConfig {}

export interface RunTestsCommandConfig extends SyntheticsCIConfig {
  configPath: string
  failOnCriticalErrors: boolean
  failOnMissingTests: boolean
  failOnTimeout: boolean
  files: string[]
  global: UserConfigOverride
  locations: string[]
  pollingTimeout: number
  publicIds: string[]
  selectiveRerun: boolean
  subdomain: string
  testSearchQuery?: string
  tunnel: boolean
  variableStrings: string[]
}

export type WrapperConfig = Partial<RunTestsCommandConfig>

export interface UploadApplicationCommandConfig extends SyntheticsCIConfig {
  configPath: string
  mobileApplicationVersionFilePath?: string
  mobileApplicationId?: string
  versionName?: string
  latest?: boolean
}
export interface PresignedUrlResponse {
  file_name: string
  presigned_url_params: {
    fields: {
      [key: string]: string
    }
    url: string
  }
}

// Not the entire response, but only what's needed.
export interface SyntheticsOrgSettings {
  onDemandConcurrencyCap: number
}

export interface MobileApplicationVersion {
  id?: string
  application_id: string
  file_name: string
  original_file_name: string
  is_latest: boolean
  version_name: string
  created_at?: string
}
