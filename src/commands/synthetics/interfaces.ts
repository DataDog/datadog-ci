import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'

import {TunnelInfo} from './tunnel'

export type SupportedReporter = 'junit' | 'default'

export interface MainReporter {
  log(log: string): void
  error(error: string): void
  initErrors(errors: string[]): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, config: UserConfigOverride): void
  testWait(test: Test): void
  testsWait(tests: Test[], baseUrl: string, batchId: string, skippedCount?: number): void
  resultReceived(result: ResultInBatch): void
  resultEnd(result: Result, baseUrl: string, batchId: string): void
  reportStart(timings: {startTime: number}): void
  runEnd(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings): void
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
  result?: ServerResult
  resultID: string
  timestamp: number
}

/**
 * Information required to convert a `PollResult` to a `Result`.
 */
export type ResultDisplayInfo = {
  getLocation: (datacenterId: string, test: Test) => string
  options: {
    batchTimeout: number
    datadogSite: string
    failOnCriticalErrors?: boolean
    failOnTimeout?: boolean
    subdomain: string
  }
  tests: Test[]
}

export type SelectiveRerunDecision =
  | {
      decision: 'run'
      reason: 'in_progress'
    }
  | {
      decision: 'run'
      reason: 'failed'
      linked_result_id: string
    }
  | {
      decision: 'run'
      reason: 'edited'
    }
  | {
      decision: 'run'
      reason: 'new'
    }
  | {
      decision: 'skip'
      reason: 'passed'
      linked_result_id: string
    }

export interface BaseResult {
  /** Duration of the result in milliseconds. */
  duration: number
  executionRule: ExecutionRule
  initialResultId?: string
  /** Whether the result is an intermediary result that is expected to be retried. */
  isNonFinal?: boolean
  location: string
  /** Whether the result is passed or not, according to `failOnCriticalErrors` and `failOnTimeout`. */
  passed: boolean
  result?: ServerResult
  resultId: string
  /** Number of retries, including this result. */
  retries: number
  maxRetries: number
  selectiveRerun?: SelectiveRerunDecision
  /** Original test for this result, including overrides if any. */
  test: Test
  timedOut: boolean
  timestamp: number
}

// Inside this type, `.resultId` is a linked result ID from a previous batch.
export type ResultSkippedBySelectiveRerun = Omit<
  BaseResult,
  'duration' | 'location' | 'result' | 'retries' | 'maxRetries' | 'timestamp'
> & {
  executionRule: ExecutionRule.SKIPPED
  selectiveRerun: Extract<SelectiveRerunDecision, {decision: 'skip'}>
}

export type Result = BaseResult | ResultSkippedBySelectiveRerun

type Status = 'passed' | 'failed' | 'in_progress' | 'skipped'
type BatchStatus = 'passed' | 'failed' | 'in_progress'

export interface BaseResultInBatch {
  duration: number
  execution_rule: ExecutionRule
  initial_result_id?: string
  location: string
  result_id: string
  retries: number | null
  max_retries: number | null
  selective_rerun?: SelectiveRerunDecision
  status: Status
  test_public_id: string
  timed_out: boolean | null
}

type SkippedResultInBatch = Omit<BaseResultInBatch, 'duration' | 'location' | 'result_id'> & {
  execution_rule: ExecutionRule.SKIPPED
  status: 'skipped'
}

export type ResultInBatchSkippedBySelectiveRerun = SkippedResultInBatch & {
  selective_rerun: Extract<SelectiveRerunDecision, {decision: 'skip'}>
}

export type ResultInBatch = BaseResultInBatch | ResultInBatchSkippedBySelectiveRerun

export interface Batch {
  results: ResultInBatch[]
  status: BatchStatus
}

type ServerResultInBatch = BaseResultInBatch | SkippedResultInBatch

export interface ServerBatch {
  // The batch from the server contains skipped results, which we're going to remove since we don't
  // care about skipped results internally (except when they are skipped by a selective rerun).
  results: ServerResultInBatch[]
  status: BatchStatus
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

export interface LocalTestDefinition {
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
    steps?: {subtype: string}[] // For multistep API tests
    variables: string[]
  }
  locations: string[]
  message: string
  name: string
  options: {
    ci?: {
      executionRule: ExecutionRule
    }
    device_ids?: string[]
    mobileApplication?: MobileApplication
    retry?: {
      count?: number
    }
  }
  /** Can be used to link to an existing remote test. */
  public_id?: string
  subtype: string
  tags: string[]
  type: string
}

export interface ServerTest extends LocalTestDefinition {
  monitor_id: number
  status: 'live' | 'paused'
  public_id: string
}

export type Test = (ServerTest | LocalTestDefinition) & {
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
  selective_rerun_rate_limited?: boolean
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

export interface CookiesObject {
  append?: boolean
  value: string
}

export interface BaseConfigOverride {
  allowInsecureCertificates?: boolean
  basicAuth?: BasicAuthCredentials
  body?: string
  bodyType?: string
  cookies?: string | CookiesObject
  setCookies?: string | CookiesObject
  defaultStepTimeout?: number
  deviceIds?: string[]
  executionRule?: ExecutionRule
  followRedirects?: boolean
  headers?: {[key: string]: string}
  locations?: string[]
  // TODO SYNTH-12989: Clean up deprecated `pollingTimeout` in favor of `batchTimeout`
  /** @deprecated This property is deprecated, please use `batchTimeout` in the global configuration file or `--batchTimeout` instead. */
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
  appExtractedMetadata?: MobileAppExtractedMetadata
}

export interface BatchOptions {
  batch_timeout?: number
  selective_rerun?: boolean
}

export interface Payload {
  metadata?: Metadata
  tests: TestPayload[]
  options?: BatchOptions
}

export interface BaseTestPayload extends ServerConfigOverride {
  executionRule?: ExecutionRule
}
export interface LocalTestPayload extends BaseTestPayload {
  local_test_definition: LocalTestDefinition
}
export interface RemoteTestPayload extends BaseTestPayload {
  public_id: string
}
export type TestPayload = LocalTestPayload | RemoteTestPayload

export interface TestNotFound {
  errorMessage: string
}

export interface TestSkipped {
  overriddenConfig: TestPayload
}

export interface TestWithOverride {
  test: Test
  overriddenConfig: TestPayload
}

export interface MobileTestWithOverride extends TestWithOverride {
  test: Test & {
    type: 'mobile'
    options: {
      mobileApplication: MobileApplication
    }
  }
}

export interface BasicAuthCredentials {
  password: string
  username: string
}

interface BaseTriggerConfig {
  // TODO SYNTH-12989: Clean up deprecated `config` in favor of `testOverrides`
  /** @deprecated This property is deprecated, please use `testOverrides` instead. */
  config?: UserConfigOverride
  testOverrides?: UserConfigOverride
  suite?: string
}
export interface RemoteTriggerConfig extends BaseTriggerConfig {
  id: string
}
export interface LocalTriggerConfig extends BaseTriggerConfig {
  localTestDefinition: LocalTestDefinition
}
export type TriggerConfig = RemoteTriggerConfig | LocalTriggerConfig

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
  // Number of results expected by datadog-ci, prior to any selective rerun.
  expected: number
  failed: number
  failedNonBlocking: number
  passed: number
  previouslyPassed: number
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
  batchTimeout?: number
  configPath: string
  defaultTestOverrides?: UserConfigOverride
  failOnCriticalErrors: boolean
  failOnMissingTests: boolean
  failOnTimeout: boolean
  files: string[]
  // TODO SYNTH-12989: Clean up deprecated `global` in favor of `defaultTestOverrides`
  /** @deprecated This property is deprecated, please use `defaultTestOverrides` instead. */
  global?: UserConfigOverride
  jUnitReport?: string
  // TODO SYNTH-12989: Clean up `locations` that should only be part of test overrides
  /** @deprecated This property should only be used inside of `defaultTestOverrides` or `testOverrides`. */
  locations?: string[]
  mobileApplicationVersionFilePath?: string
  // TODO SYNTH-12989: Clean up deprecated `pollingTimeout` in favor of `batchTimeout`
  /** @deprecated This property is deprecated, please use `batchTimeout` in the global configuration file or `--batchTimeout` instead. */
  pollingTimeout?: number
  publicIds: string[]
  /** Whether to only run the tests which failed in the previous test batches. By default, the organization default setting is used. */
  selectiveRerun?: boolean
  subdomain: string
  testSearchQuery?: string
  tunnel: boolean
  // TODO SYNTH-12989: Clean up deprecated `variableStrings` in favor of `variables` in `defaultTestOverrides`.
  /** @deprecated This property is deprecated, please use `variables` inside of `defaultTestOverrides`. */
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

export interface MobileApplicationUploadPart {
  partNumber: number
  md5: string
  blob: Buffer
}

export interface MobileApplicationUploadPartResponse {
  PartNumber: number
  ETag: string
}

export interface MultipartPresignedUrlsResponse {
  file_name: string
  multipart_presigned_urls_params: {
    key: string
    upload_id: string
    urls: {
      [key: string]: string
    }
  }
}

export type MobileApplicationNewVersionParams = {
  originalFileName: string
  versionName: string
  isLatest: boolean
}

export type AppUploadDetails = {appId: string; appPath: string; versionName?: string}

type MobileAppValidationStatus = 'pending' | 'complete' | 'error' | 'user_error'

type MobileInvalidAppResult = {
  invalid_reason: string
  invalid_message: string
}

export type MobileAppExtractedMetadata = Record<string, unknown>

type MobileValidAppResult = {
  extracted_metadata: MobileAppExtractedMetadata
  app_version_uuid: string
}

type MobileUserErrorResult = {
  user_error_reason: string
  user_error_message: string
}

export type MobileAppUploadResult = {
  status: MobileAppValidationStatus
  is_valid?: boolean
  org_uuid?: string
  invalid_app_result?: MobileInvalidAppResult
  valid_app_result?: MobileValidAppResult
  user_error_result?: MobileUserErrorResult
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
