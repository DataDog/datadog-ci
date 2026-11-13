import {randomBytes} from 'node:crypto'

import type {
  Environment,
  FlushResult,
  GithubContext,
  Level,
  RecordedEvent,
  RecordSpanOptions,
  Span,
  SpanData,
  SpanEndOptions,
  TagOptions,
  Tags,
  UploadOptions,
} from './types'

import {createGithubContext} from './github'
import {planRequests} from './payloads'
import {upload} from './upload'
import {cleanMeasures, cleanTags, warn} from './validation'

export type {FlushResult, Level, Span, SpanEndOptions, TagOptions, Tags, UploadOptions} from './types'
export type {RecordSpanOptions} from './types'

export const createRecorder = ({
  env = process.env,
  onWarning,
}: {env?: Environment; onWarning?: (message: string) => void} = {}) => {
  const captureContext = createGithubContext(env)
  const pending: RecordedEvent[] = []
  let warned = false
  let flushing: Promise<FlushResult> | undefined
  const bestEffort = (operation: () => void) => {
    try {
      operation()
    } catch {
      if (!warned) {
        warned = true
        warn(onWarning, 'Could not record annotation', env)
      }
    }
  }
  const enabled = () => env.GITHUB_ACTIONS === 'true' && env.DD_CI_VISIBILITY_ENABLED?.toLowerCase() !== 'false'
  const record = (event: RecordedEvent) => {
    if (
      !event.context.ciEnv.GITHUB_REPOSITORY ||
      !event.context.ciEnv.GITHUB_RUN_ID ||
      !event.context.ciEnv.GITHUB_JOB
    ) {
      throw new Error('Missing GitHub context')
    }
    pending.push(event)
  }
  const recordTags = (tags: Tags, {levels = ['job'], steps = 'current'}: TagOptions = {}) =>
    bestEffort(() => {
      if (!enabled()) {
        return
      }
      if (
        !levels.length ||
        levels.some((level) => !['pipeline', 'job', 'step'].includes(level)) ||
        !['current', 'all'].includes(steps)
      ) {
        throw new Error('Unsupported annotation target')
      }
      const values = cleanTags(tags)
      if (Object.keys(values).length) {
        record({context: captureContext(), type: 'tags', tags: values, levels: [...new Set(levels)], steps})
      }
    })
  const recordMeasure = (name: string, value: number, {level = 'job'}: {level?: Level} = {}) =>
    bestEffort(() => {
      if (!enabled()) {
        return
      }
      if (!['pipeline', 'job', 'step'].includes(level)) {
        throw new Error('Unsupported annotation target')
      }
      record({context: captureContext(), type: 'measure', measures: cleanMeasures({[name]: value}), level})
    })
  const recordStartSpan = (
    name: string,
    initialTags: Tags = {},
    timing?: Pick<RecordSpanOptions, 'startTimeMs' | 'endTimeMs' | 'command'>
  ): Span => {
    const start = timing?.startTimeMs ?? Date.now()
    let duration: number | undefined
    let context: GithubContext | undefined
    let data: SpanData | undefined
    bestEffort(() => {
      if (enabled()) {
        context = captureContext()
        data = {
          span_id: randomBytes(8).toString('hex'),
          name,
          command: timing?.command ?? name,
          start_time: new Date(start).toISOString(),
          end_time: '',
          exit_code: 0,
          error_message: '',
          tags: {...context.tags},
          measures: {},
        }
      }
    })
    const currentSpan: Span = {
      setTags: (tags) =>
        bestEffort(() => {
          if (data && duration === undefined) {
            Object.assign(data.tags, cleanTags(tags, false))
          }
        }),
      setMeasure: (key, value) =>
        bestEffort(() => {
          if (data && duration === undefined) {
            Object.assign(data.measures, cleanMeasures({[key]: value}))
          }
        }),
      end: (options: SpanEndOptions = {}) => {
        if (duration !== undefined) {
          return duration
        }
        const end = timing?.endTimeMs ?? Date.now()
        bestEffort(() => {
          if (data) {
            Object.assign(data.tags, cleanTags(options.tags || {}, false))
          }
        })
        bestEffort(() => {
          if (data) {
            Object.assign(data.measures, cleanMeasures(options.measures || {}))
          }
        })
        bestEffort(() => {
          if (data) {
            const exitCode = options.exitCode ?? (options.error === undefined ? 0 : 1)
            if (!Number.isSafeInteger(exitCode) || exitCode < 0) {
              throw new Error('Exit codes must be nonnegative integers')
            }
            data.exit_code = exitCode
            data.error_message =
              exitCode === 0
                ? ''
                : options.error === undefined
                  ? 'Span failed'
                  : options.error instanceof Error
                    ? options.error.message
                    : String(options.error)
          }
        })
        duration = end - start
        bestEffort(() => {
          if (data && context) {
            data.end_time = new Date(end).toISOString()
            record({context, type: 'span', span: data})
          }
        })

        return duration
      },
    }
    currentSpan.setTags(initialTags)

    return currentSpan
  }
  const recordCompletedSpan = (options: RecordSpanOptions): void =>
    bestEffort(() => {
      if (!enabled()) {
        return
      }
      const {name, command, startTimeMs, endTimeMs} = options
      if (
        typeof name !== 'string' ||
        !name.trim() ||
        (command !== undefined && (typeof command !== 'string' || !command.trim()))
      ) {
        throw new Error('Span name and command must be nonempty strings')
      }
      if (!Number.isSafeInteger(startTimeMs) || !Number.isSafeInteger(endTimeMs) || endTimeMs < startTimeMs) {
        throw new Error('Span timestamps must be integer milliseconds with endTimeMs >= startTimeMs')
      }
      recordStartSpan(name, {}, options).end(options)
    })
  const wrapSpan = async <T>(name: string, callback: (currentSpan: Span) => T | Promise<T>): Promise<T> => {
    const currentSpan = recordStartSpan(name)
    try {
      const result = await callback(currentSpan)
      currentSpan.end()

      return result
    } catch (error) {
      currentSpan.end({error, exitCode: 1})
      throw error
    }
  }
  const flushRecords = async (options: UploadOptions = {}): Promise<FlushResult> => {
    if (!enabled()) {
      const skipped = planRequests(pending.splice(0)).requests.length

      return {sent: 0, failed: 0, skipped}
    }
    if (flushing) {
      await flushing

      return flushRecords(options)
    }
    const records = pending.splice(0)
    const plan = planRequests(records)
    flushing = upload(
      plan.requests,
      {
        ...options,
        apiKey: options.apiKey || env.DATADOG_API_KEY || env.DD_API_KEY,
        site: options.site || env.DATADOG_SITE || env.DD_SITE,
        onWarning: options.onWarning || onWarning,
      },
      env
    ).then(({sent, failed, skipped}) => ({sent, failed, skipped: skipped + plan.skipped}))
    try {
      return await flushing
    } finally {
      flushing = undefined
    }
  }

  return {
    span: wrapSpan,
    startSpan: (name: string, tags?: Tags): Span => recordStartSpan(name, tags),
    recordSpan: recordCompletedSpan,
    setTags: recordTags,
    setMeasure: recordMeasure,
    flush: flushRecords,
  }
}

export const {span, startSpan, recordSpan, setTags, setMeasure, flush} = createRecorder()
