export const TRACING_MODES = ['manual', 'disabled', 'inject'] as const

export type TracingMode = (typeof TRACING_MODES)[number]
