export type Environment = Record<string, string | undefined>
export type Tags = Record<string, string | undefined>
export type Measures = Record<string, number | undefined>
export type Level = 'pipeline' | 'job' | 'step'

export interface Span {
  setTags(tags: Tags): void
  setMeasure(name: string, value: number): void
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

interface Envelope {
  version: 1
  id: string
  recordedAt: string
  context: GithubContext
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

export type RecordedEvent = Envelope &
  (
    | {type: 'span'; span: SpanData}
    | {type: 'tags'; tags: Record<string, string>; levels: Level[]; steps: 'current' | 'all'}
    | {type: 'measure'; measures: Record<string, number>; level: Level}
  )
