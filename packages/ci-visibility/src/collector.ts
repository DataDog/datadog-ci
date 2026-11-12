import {readFileSync, readdirSync, unlinkSync} from 'node:fs'
import {join} from 'node:path'

import type {RecordedEvent, UploadOptions, FlushResult} from './types'

import {planRequests} from './payloads'
import {upload} from './upload'
import {warn} from './validation'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && !!value && !Array.isArray(value)
const stringMap = (value: unknown): boolean =>
  isObject(value) && Object.values(value).every((item) => typeof item === 'string')
const measureMap = (value: unknown): boolean =>
  isObject(value) && Object.values(value).every((item) => typeof item === 'number' && Number.isFinite(item))
const validLevel = (value: unknown): boolean => ['pipeline', 'job', 'step'].includes(String(value))

const isEvent = (value: unknown): value is RecordedEvent => {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.recordedAt !== 'string' ||
    !isObject(value.context) ||
    !stringMap(value.context.ciEnv) ||
    !stringMap(value.context.tags) ||
    !Array.isArray(value.context.stepIndices) ||
    !value.context.stepIndices.every((index) => Number.isSafeInteger(index) && index >= 0)
  ) {
    return false
  }
  const ciEnv = value.context.ciEnv as Record<string, string>
  if (
    !ciEnv.GITHUB_SERVER_URL ||
    !ciEnv.GITHUB_REPOSITORY ||
    !ciEnv.GITHUB_RUN_ID ||
    !ciEnv.GITHUB_JOB ||
    !ciEnv.GITHUB_RUN_ATTEMPT ||
    !ciEnv.DD_GITHUB_JOB_NAME ||
    (ciEnv.DD_GITHUB_STEP_INDEX !== undefined && !/^\d+$/.test(ciEnv.DD_GITHUB_STEP_INDEX))
  ) {
    return false
  }
  switch (value.type) {
    case 'span': {
      const span = value.span

      return (
        isObject(span) &&
        ['span_id', 'name', 'command', 'start_time', 'end_time', 'error_message'].every(
          (key) => typeof span[key] === 'string'
        ) &&
        typeof span.exit_code === 'number' &&
        Number.isFinite(span.exit_code) &&
        stringMap(span.tags) &&
        measureMap(span.measures)
      )
    }
    case 'tags':
      return (
        stringMap(value.tags) &&
        Array.isArray(value.levels) &&
        value.levels.length > 0 &&
        value.levels.every(validLevel) &&
        ['current', 'all'].includes(String(value.steps))
      )
    case 'measure':
      return measureMap(value.measures) && validLevel(value.level)
    default:
      return false
  }
}

/** Upload completed files only. Producers must finish before the directory is collected. */
export const uploadDirectory = async (
  directory: string,
  options: UploadOptions & {dryRun?: boolean} = {}
): Promise<FlushResult> => {
  try {
    const files = new Map<string, string>()
    const records: RecordedEvent[] = []
    let invalid = 0
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }
      try {
        const file = join(directory, entry.name)
        const record: unknown = JSON.parse(readFileSync(file, 'utf8'))
        if (!isEvent(record)) {
          throw new Error('Invalid record')
        }
        records.push(record)
        files.set(record.id, file)
      } catch {
        invalid++
      }
    }
    if (invalid) {
      warn(options.onWarning, `Skipped ${invalid} incompatible or malformed record(s)`)
    }
    const {requests, skipped} = planRequests(records)
    if (options.dryRun) {
      return {sent: 0, failed: 0, skipped: requests.length + skipped + invalid}
    }
    const result = await upload(requests, options)
    for (const id of result.completedIds) {
      try {
        unlinkSync(files.get(id)!)
      } catch {
        warn(options.onWarning, 'Could not remove an uploaded record; collecting again may repeat it')
      }
    }

    return {sent: result.sent, failed: result.failed, skipped: result.skipped + skipped + invalid}
  } catch {
    warn(options.onWarning, 'Could not collect the recording directory')

    return {sent: 0, failed: 0, skipped: 0}
  }
}
