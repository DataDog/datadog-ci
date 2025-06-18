import {Metadata} from '../../helpers/interfaces'
import {ProxyConfiguration} from '../../helpers/utils'

import {RecursivePartial} from './base-command'
import {TunnelInfo} from './tunnel'

export type SupportedReporter = 'junit' | 'default'

export interface MainReporter {
  log(log: string): void
  error(error: string): void
  initErrors(errors: string[]): void
  testTrigger(test: Test, testId: string, executionRule: ExecutionRule, testOverrides: UserConfigOverride): void
  testWait(test: Test): void
  testsWait(tests: Test[], baseUrl: string, batchId: string, skippedCount?: number): void
  resultReceived(result: ResultInBatch): void
  resultEnd(result: Result, baseUrl: string, batchId: string): void
  reportStart(timings: {startTime: number}): void
  runEnd(summary: Summary, baseUrl: string, orgSettings?: SyntheticsOrgSettings): void
}

export type Reporter = Partial<MainReporter>

export interface BaseServerResult {
  id: string
  status: 'passed' | 'failed' | 'skipped'
  failure?: {
    code: string
    message: string
  }
  unhealthy?: boolean
  finished_at: number
}

export interface Device {
  id: string
  resolution: {
    width: number
    height: number
  }
}

export interface BrowserServerResult extends BaseServerResult {
  duration: number
  start_url: string
  steps: Step[]
}

interface AssertionResult {
  actual: any
  expected?: any
  valid: boolean
}

export interface ApiServerResult extends BaseServerResult {
  assertions: AssertionResult[]
  timings: {
    total: number
  }
}

export interface MultiStep {
  allow_failure: boolean
  assertion_results: AssertionResult[]
  failure?: {
    code: string
    message: string
  }
  name: string
  status: 'passed' | 'failed' | 'skipped'
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

export interface RawPollResult {
  data: {
    id: string
    type: string
    attributes: Omit<PollResult, 'test'>
    relationships: {
      test: {
        data: {
          id: string
          type: string
        }
      }
    }
  }[]
  included: {
    type: string
    id: string
    attributes: Pick<RawPollResultTest, 'type' | 'subtype' | 'config'>
  }[]
}

export interface RawPollResultTest {
  id: string
  type: 'browser' | 'api' | 'mobile'
  subtype?: string
  config: {
    request?: {
      dns_server?: string | undefined
    }
  }
}

export type PollResult = {
  test_type: 'api' | 'browser' | 'mobile'
  test: RecursivePartial<Test>
  result?: ServerResult
  resultID: string
  device?: Device
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
  device?: Device
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
  allow_failure: boolean
  browser_errors: BrowserError[]
  description: string
  duration: number
  failure?: {
    code?: string
    message: string
  }
  public_id?: string
  status: string
  id?: number // Navigation step has no id
  element_updates?: {
    multi_locator?: MultiLocator
  }
  sub_test_public_id?: string
  sub_test_step_details?: Step[]
  type: string
  url: string
  value?: string | number
  vitals_metrics: Vitals[]
  warnings?: {
    message: string
    type: string
  }[]
}

export interface MultiLocator {
  [key: string]: unknown
}

// TODO SYNTH-17944 Remove unsupported fields

export interface TestStepWithUnsupportedFields {
  public_id?: string
  params: {
    element?: {
      multiLocator?: MultiLocator
      userLocator?: unknown
    }
  }
}

export interface LocalTestDefinition {
  config: {
    assertions: Assertion[]
    request?: {
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
  name: string
  options: OptionsWithUnsupportedFields
  /** Can be used to link to an existing remote test. */
  public_id?: string
  subtype?: string // This is optional in the browser and api schemas
  steps?: TestStepWithUnsupportedFields[] // From browser schema
  type: 'api' | 'browser' | 'mobile'
}

interface Options {
  ci?: {
    executionRule: ExecutionRule
  }
  device_ids?: string[]
  mobileApplication?: MobileApplication
  retry?: {
    count?: number
  }
}

// TODO SYNTH-17944 Remove unsupported fields

export interface OptionsWithUnsupportedFields extends Options {
  bindings?: null | unknown[]
  min_failure_duration?: number
  min_location_failed?: any
  monitor_name?: string
  monitor_options?: any
  monitor_priority?: number
  tick_every?: number
}

// TODO SYNTH-17944 Remove unsupported fields
// I think a bunch of these are front-end specific fields
interface LocalTestDefinitionWithUnsupportedFields extends LocalTestDefinition {
  created_at?: any
  created_by?: any
  creator?: any
  creation_source?: string
  message?: string
  modified_at?: any
  modified_by?: any
  monitor_id?: number
  overall_state?: any
  overall_state_modified?: any
  status?: string
  stepCount?: any
  tags?: string[]
  version?: any
  version_uuid?: any
}
export interface ServerTest extends LocalTestDefinitionWithUnsupportedFields {
  monitor_id: number
  status: 'live' | 'paused'
  public_id: string
}

export type Test = (ServerTest | LocalTestDefinitionWithUnsupportedFields) & {
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
  resourceUrlSubstitutionRegexes?: string[]
  retry?: RetryConfig
  startUrl?: string
  startUrlSubstitutionRegex?: string
  testTimeout?: number
  variables?: {[key: string]: string}
}

export interface UserConfigOverride extends BaseConfigOverride {
  mobileApplicationVersion?: string
  mobileApplicationVersionFilePath?: string
}

export interface ServerConfigOverride extends BaseConfigOverride {
  mobileApplication?: MobileApplication
  appExtractedMetadata?: MobileAppExtractedMetadata
  // XXX: This would be better passed as a batch option in the future since it's always the same for all tests.
  tunnel?: TunnelInfo
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

export interface LocalTestPayload extends ServerConfigOverride {
  local_test_definition: LocalTestDefinition
}
export interface RemoteTestPayload extends ServerConfigOverride {
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

export interface TestConfig {
  tests: TriggerConfig[]
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
  baseV1Url: string
  baseV2Url: string
  proxyOpts: ProxyConfiguration
}

export interface APIHelperConfig {
  apiKey: string
  appKey: string
  datadogSite: string
  proxy: ProxyConfiguration
}

export interface DatadogCIConfig extends APIHelperConfig {
  configPath: string
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SyntheticsCIConfig extends DatadogCIConfig {}

export interface RunTestsCommandConfig extends SyntheticsCIConfig {
  batchTimeout?: number
  buildCommand?: string
  defaultTestOverrides?: UserConfigOverride
  failOnCriticalErrors: boolean
  failOnMissingTests: boolean
  failOnTimeout: boolean
  files: string[]
  jUnitReport?: string
  mobileApplicationVersionFilePath?: string
  publicIds: string[]
  /** Whether to only run the tests which failed in the previous test batches. By default, the organization default setting is used. */
  selectiveRerun?: boolean
  /** Used to create URLs to the Datadog UI. */
  subdomain: string
  testSearchQuery?: string
  tunnel: boolean
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

export interface ImportTestsCommandConfig extends SyntheticsCIConfig {
  configPath: string
  files: string[]
  publicIds: string[]
  testSearchQuery?: string
}

export interface DeployTestsCommandConfig extends SyntheticsCIConfig {
  configPath: string
  excludeFields?: string[]
  files: string[]
  publicIds: string[]
  subdomain: string
}
