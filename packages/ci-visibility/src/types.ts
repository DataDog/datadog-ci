export type Environment = Record<string, string | undefined>
export type Tags = Record<string, string | undefined>
export type Measures = Record<string, number | undefined>
export type Level = 'pipeline' | 'job' | 'step'

export interface SpanEndOptions {
  /** Defaults to 0, or 1 when an error is supplied. */
  exitCode?: number
  error?: unknown
  tags?: Tags
  measures?: Measures
}

export interface RecordSpanOptions extends SpanEndOptions {
  name: string
  /** Defaults to the span name. */
  command?: string
  /** Integer milliseconds since the Unix epoch. */
  startTimeMs: number
  /** Integer milliseconds since the Unix epoch; may equal startTimeMs. */
  endTimeMs: number
}

export interface Span {
  setTags(tags: Tags): void
  setMeasure(name: string, value: number): void
  /** Queue the completed span once and return its duration in milliseconds. */
  end(options?: SpanEndOptions): number
}

export interface TagOptions {
  levels?: Level[]
  /** Apply step annotations to all declared main steps of the current job. */
  steps?: 'current' | 'all'
}

export interface UploadOptions {
  apiKey?: string
  site?: string
  /** Overall upload budget, including retries. Defaults to 10 seconds. */
  timeoutMs?: number
  /** Deadline for an individual request. Defaults to 4 seconds. */
  requestTimeoutMs?: number
  onWarning?: (message: string) => void
}

/** Counts HTTP requests, including requests abandoned after a transport failure. */
export interface FlushResult {
  sent: number
  failed: number
  skipped: number
}

export interface GithubContext {
  ciEnv: Record<string, string>
  tags: Record<string, string>
  stepIndices: number[]
}

export interface SpanData {
  span_id: string
  name: string
  command: string
  start_time: string
  end_time: string
  exit_code: number
  error_message: string
  tags: Record<string, string>
  measures: Record<string, number>
}

export type RecordedEvent = {context: GithubContext} & (
  | {type: 'span'; span: SpanData}
  | {type: 'tags'; tags: Record<string, string>; levels: Level[]; steps: 'current' | 'all'}
  | {type: 'measure'; measures: Record<string, number>; level: Level}
)
