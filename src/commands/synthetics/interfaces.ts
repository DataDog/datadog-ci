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
  /** The number of attempts to perform in case of test failure. */
  count: number
  /** The interval between attempts in milliseconds. */
  interval: number
}

export interface MobileApplication {
  applicationId: string
  referenceId: string
  referenceType: 'latest' | 'version' | 'temporary'
}

export interface CookieSettings {
  /** Whether to append or replace the original cookies. */
  append?: boolean
  /** Cookie header to add or replace (e.g. `name1=value1;name2=value2;`). */
  value: string
}

export interface BaseConfigOverride {
  /** Disable certificate checks in Synthetic API tests. */
  allowInsecureCertificates?: boolean
  /** Credentials to provide if basic authentication is required. */
  basicAuth?: BasicAuthCredentials
  /** Data to send in an API test. */
  body?: string
  /** Content type for the data to send in an API test. */
  bodyType?: string
  /**
   * Use the provided string as a cookie header in an API or browser test (in addition or as a replacement).
   * - If this is a string (e.g. `name1=value1;name2=value2;`), it is used to replace the original cookies.
   * - If this is an object, it is used to either add to or replace the original cookies, depending on `append`.
   */
  cookies?: string | CookieSettings
  /** The maximum duration of steps in seconds for browser tests, which does not override individually set step timeouts. */
  defaultStepTimeout?: number
  /** A list of devices to run the browser test on. */
  deviceIds?: string[]
  /**
   * The execution rule for the test defines the behavior of the CLI in case of a failing test.
   * - `blocking`: The CLI returns an error if the test fails.
   * - `non_blocking`: The CLI only prints a warning if the test fails.
   * - `skipped`: The test is not executed at all.
   */
  executionRule?: ExecutionRule
  /** Indicates whether or not to follow HTTP redirections in Synthetic API tests. */
  followRedirects?: boolean
  /** The headers to replace in the test. This object should contain keys as the name of the header to replace and values as the new value of the header to replace. */
  headers?: {[key: string]: string}
  /** A list of locations to run the test from. */
  locations?: string[]
  /** The maximum duration in milliseconds of a test. If the execution exceeds this value, it is considered failed. */
  pollingTimeout?: number
  /** The retry policy for the test. */
  retry?: RetryConfig
  /** The new start URL to provide to the test. Variables specified in brackets (for example, `{{ EXAMPLE }}`) found in environment variables are replaced. */
  startUrl?: string
  /** The regex to modify the starting URL of the test (for browser and HTTP tests only), whether it was given by the original test or the configuration override `startUrl`. */
  startUrlSubstitutionRegex?: string
  /** The variables to replace in the test. This object should contain key as the name of the variable to replace and values as the new value of the variable to replace. */
  variables?: {[key: string]: string}
}

export interface UserConfigOverride extends BaseConfigOverride {
  /** The ID of an application version to run a Synthetic mobile application test on. */
  mobileApplicationVersion?: string
  /** Upload an application as a temporary version for a Synthetic mobile application test. */
  mobileApplicationVersionFilePath?: string
}

export interface ServerConfigOverride extends BaseConfigOverride {
  mobileApplication?: MobileApplication // Programmatically set with `overrideMobileConfig()`.
  tunnel?: TunnelInfo // Programmatically set with `tunnel.start()`.
}

export interface Payload {
  metadata?: Metadata
  tests: TestPayload[]
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
  /** Overrides for this Synthetic test only. This takes precedence over all other overrides. */
  config: UserConfigOverride
  /** Public ID of a test (e.g. `abc-def-ghi`), or its full URL (e.g. `https://app.datadoghq.com/synthetics/details/abc-def-ghi`). */
  id: string
  /** Name of a test suite (for JUnit reports). */
  suite?: string
}

export enum ExecutionRule {
  BLOCKING = 'blocking',
  NON_BLOCKING = 'non_blocking',
  SKIPPED = 'skipped',
}

export interface TestFile {
  tests: TriggerConfig[]
}

export interface Suite {
  content: TestFile
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
  /** The API key used to query the Datadog API. */
  apiKey: string
  /** The application key used to query the Datadog API. */
  appKey: string
  /** The Datadog instance to which request is sent. */
  datadogSite: string
  /** The proxy to be used for outgoing connections to Datadog. */
  proxy: ProxyConfiguration
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SyntheticsCIConfig extends APIHelperConfig {}

export interface RunTestsLibConfig extends SyntheticsCIConfig {
  /** A boolean flag that fails the CI job if no tests were triggered, or results could not be fetched from Datadog. */
  failOnCriticalErrors: boolean
  /** A boolean flag that fails the CI job if at least one specified test with a public ID is missing in a run (for example, if it has been deleted programmatically or on the Datadog site). */
  failOnMissingTests: boolean
  /** A boolean flag that fails the CI job if at least one test exceeds the default test timeout. */
  failOnTimeout: boolean
  /** Glob patterns to detect Synthetic test configuration files (their well-known name is `*.synthetics.json`). */
  files: string[]
  /** Overrides for Synthetic tests applied to all tests. */
  global: UserConfigOverride
  /** The duration (in milliseconds) after which polling for test results is stopped. */
  pollingTimeout: number
  /** The name of the custom subdomain set to access your Datadog application. If the URL used to access Datadog is `myorg.datadoghq.com`, the `subdomain` value needs to be set to `myorg`. */
  subdomain: string
  /** Search query to select which Synthetic tests to run. */
  testSearchQuery?: string
  /** Use the Continuous Testing Tunnel to execute your test batch. */
  tunnel: boolean
}

export interface RunTestsCommandConfig extends RunTestsLibConfig {
  configPath: string
  locations: string[]
  publicIds: string[]
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

// not the entire response, but only the slice needed
export interface SyntheticsOrgSettings {
  orgMaxConcurrencyCap: number
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
