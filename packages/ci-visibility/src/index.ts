import {randomBytes, randomUUID} from 'node:crypto'
import {renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import type {
  Environment,
  FlushResult,
  Level,
  RecordedEvent,
  Span,
  SpanData,
  TagOptions,
  Tags,
  UploadOptions,
} from './types'

import {createGithubContext} from './github'
import {planRequests} from './payloads'
import {upload} from './upload'
import {cleanMeasures, cleanTags, warn} from './validation'

export type {FlushResult, Level, Span, TagOptions, Tags, UploadOptions} from './types'

export const createRecorder = ({
  env = process.env,
  onWarning,
}: {env?: Environment; onWarning?: (message: string) => void} = {}) => {
  const captureContext = createGithubContext(env)
  const pending: RecordedEvent[] = []
  let sequence = 0
  let warned = false
  let flushing: Promise<FlushResult> | undefined
  const bestEffort = (operation: () => void) => {
    try {
      operation()
    } catch {
      if (!warned) {
        warned = true
        warn(onWarning, 'Could not record annotation')
      }
    }
  }
  const enabled = () => env.GITHUB_ACTIONS === 'true' && env.DD_CI_VISIBILITY?.toLowerCase() !== 'false'
  const envelope = () => ({
    version: 1 as const,
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    context: captureContext(),
  })
  const record = (event: RecordedEvent) => {
    if (
      !event.context.ciEnv.GITHUB_REPOSITORY ||
      !event.context.ciEnv.GITHUB_RUN_ID ||
      !event.context.ciEnv.GITHUB_JOB
    ) {
      throw new Error('Missing GitHub context')
    }
    if (!env.DD_CI_BUFFER_DIR) {
      pending.push(event)

      return
    }
    const filename = `${event.recordedAt.replace(/:/g, '-')}-${process.pid}-${String(sequence++).padStart(8, '0')}-${event.id}.json`
    const destination = join(env.DD_CI_BUFFER_DIR, filename)
    writeFileSync(`${destination}.tmp`, JSON.stringify(event), {mode: 0o600, flag: 'wx'})
    renameSync(`${destination}.tmp`, destination)
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
        record({...envelope(), type: 'tags', tags: values, levels: [...new Set(levels)], steps})
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
      record({...envelope(), type: 'measure', measures: cleanMeasures({[name]: value}), level})
    })
  const recordSpan = async <T>(name: string, callback: (currentSpan: Span) => T | Promise<T>): Promise<T> => {
    if (!enabled()) {
      return callback({setTags: () => {}, setMeasure: () => {}})
    }
    let event: ReturnType<typeof envelope> | undefined
    bestEffort(() => {
      event = envelope()
    })
    const data: SpanData = {
      span_id: randomBytes(8).toString('hex'),
      name,
      command: name,
      start_time: new Date().toISOString(),
      end_time: '',
      exit_code: 0,
      error_message: '',
      tags: {...event?.context.tags},
      measures: {},
    }
    const currentSpan: Span = {
      setTags: (tags) =>
        bestEffort(() => {
          Object.assign(data.tags, cleanTags(tags, false))
        }),
      setMeasure: (key, value) =>
        bestEffort(() => {
          Object.assign(data.measures, cleanMeasures({[key]: value}))
        }),
    }
    try {
      return await callback(currentSpan)
    } catch (error) {
      data.exit_code = 1
      data.error_message = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      data.end_time = new Date().toISOString()
      if (event) {
        bestEffort(() => record({...event!, type: 'span', span: data}))
      }
    }
  }
  const flushRecords = async (options: UploadOptions = {}): Promise<FlushResult> => {
    if (!enabled()) {
      const skipped = planRequests(pending.splice(0)).requests.length

      return {sent: 0, failed: 0, skipped}
    }
    if (env.DD_CI_BUFFER_DIR) {
      return {sent: 0, failed: 0, skipped: 0}
    }
    if (flushing) {
      await flushing

      return flushRecords(options)
    }
    const records = pending.splice(0)
    const plan = planRequests(records)
    flushing = upload(plan.requests, {
      ...options,
      apiKey: options.apiKey || env.DATADOG_API_KEY || env.DD_API_KEY,
      site: options.site || env.DATADOG_SITE || env.DD_SITE,
      onWarning: options.onWarning || onWarning,
    }).then(({sent, failed, skipped}) => ({sent, failed, skipped: skipped + plan.skipped}))
    try {
      return await flushing
    } finally {
      flushing = undefined
    }
  }

  return {span: recordSpan, setTags: recordTags, setMeasure: recordMeasure, flush: flushRecords}
}

export const {span, setTags, setMeasure, flush} = createRecorder()
