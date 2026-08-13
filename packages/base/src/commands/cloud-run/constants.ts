import {ENVIRONMENT_ENV_VAR, SERVICE_ENV_VAR, SITE_ENV_VAR} from '../../helpers/serverless/constants'
import type {Language} from '../../helpers/serverless/ssi/tracer'
import {LANGUAGE_METADATA} from '../../helpers/serverless/ssi/tracer'

export const CLOUD_RUN_TRACER_REGISTRY = 'gcr.io/datadoghq' as const
export const DEFAULT_TRACER_VERSION = 'latest' as const
export const DEFAULT_TRACER_LIBC = 'glibc' as const

export const CLOUD_RUN_LANGUAGES = [...(Object.keys(LANGUAGE_METADATA) as Language[]), 'go'] as const
export type CloudRunLanguage = (typeof CLOUD_RUN_LANGUAGES)[number]

const TRACING_INPUT_METADATA = [
  {input: 'true', mode: 'manual'},
  {input: '1', mode: 'manual'},
  {input: 'manual', mode: 'manual'},
  {input: 'false', mode: 'disabled'},
  {input: 'disabled', mode: 'disabled'},
  {input: '0', mode: 'disabled'},
  {input: 'inject', mode: 'inject'},
] as const
export type TracingInput = (typeof TRACING_INPUT_METADATA)[number]['input']
export type TracingMode = (typeof TRACING_INPUT_METADATA)[number]['mode']
export const TRACING_INPUTS = TRACING_INPUT_METADATA.map(({input}) => input)
export const TRACING_MODE_BY_INPUT = Object.fromEntries(
  TRACING_INPUT_METADATA.map(({input, mode}) => [input, mode])
) as Record<TracingInput, TracingMode>

export const SKIP_MASKING_CLOUDRUN_ENV_VARS = new Set([
  SITE_ENV_VAR,
  SERVICE_ENV_VAR,
  ENVIRONMENT_ENV_VAR,
  'NODE_OPTIONS',
  'DD_TRACE_PROPAGATION_STYLE',
  'DD_SOURCE',
  'DD_TAGS',
  'DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT',
  'DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_GRPC_ENDPOINT',
  'GCP_PROJECT_ID',
  'DD_VERSION',
  'DD_AGENT_HOST',
  'DD_LOG_LEVEL',
  'GCP_PUBSUB_PROJECT_ID',
  'GCP_PUBSUB_SUBSCRIBER_ID',
])
