export const TRACING_INPUT_METADATA = [
  {input: 'true', mode: 'manual'},
  {input: '1', mode: 'manual'},
  {input: 'manual', mode: 'manual'},
  {input: 'false', mode: 'disabled'},
  {input: '0', mode: 'disabled'},
  {input: 'disabled', mode: 'disabled'},
  {input: 'inject', mode: 'inject'},
] as const

export type TracingInput = (typeof TRACING_INPUT_METADATA)[number]['input']
export type TracingMode = (typeof TRACING_INPUT_METADATA)[number]['mode']

export const TRACING_INPUTS = TRACING_INPUT_METADATA.map(({input}) => input)

const TRACING_MODE_BY_INPUT = Object.fromEntries(
  TRACING_INPUT_METADATA.map(({input, mode}) => [input, mode])
) as Record<TracingInput, TracingMode>

export const normalizeTracingInput = (input: TracingInput | undefined): TracingMode | undefined =>
  input === undefined ? undefined : TRACING_MODE_BY_INPUT[input]
