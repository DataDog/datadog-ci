import type {DatadogRoute} from './request/datadog-route'
import type {Level, RecordedEvent} from './types'

import {datadogRoute} from './request/datadog-route'
import {cleanMeasures, cleanTags} from './validation'

export interface UploadRequest {
  method: 'POST'
  url: DatadogRoute
  data: object
}

const levels: Record<Level, number> = {pipeline: 0, job: 1, step: 3}

export const planRequests = (records: RecordedEvent[]): {requests: UploadRequest[]; skipped: number} => {
  const requests: UploadRequest[] = []
  const patches = new Map<
    string,
    {
      type: 'tags' | 'measure'
      level: Level
      ciEnv: Record<string, string>
      values: Record<string, string | number>
    }
  >()
  let skipped = 0
  for (const record of records) {
    if (record.type === 'span') {
      requests.push({
        method: 'POST',
        url: datadogRoute('/api/intake/ci/custom_spans'),
        data: {data: {type: 'ci_app_custom_span', attributes: {ci_provider: 'github', ...record.span}}},
      })
      continue
    }
    for (const level of record.type === 'tags' ? record.levels : [record.level]) {
      const ciEnv = record.context.ciEnv
      const indices =
        level !== 'step'
          ? [undefined]
          : record.type === 'tags' && record.steps === 'all'
            ? record.context.stepIndices
            : ciEnv.DD_GITHUB_STEP_INDEX === undefined
              ? []
              : [Number(ciEnv.DD_GITHUB_STEP_INDEX)]
      if (!indices.length) {
        skipped++
      }
      for (const index of indices) {
        const target: Record<string, string> = {
          GITHUB_SERVER_URL: ciEnv.GITHUB_SERVER_URL,
          GITHUB_REPOSITORY: ciEnv.GITHUB_REPOSITORY,
          GITHUB_RUN_ID: ciEnv.GITHUB_RUN_ID,
          GITHUB_RUN_ATTEMPT: ciEnv.GITHUB_RUN_ATTEMPT,
          GITHUB_JOB: ciEnv.GITHUB_JOB,
        }
        if (level !== 'pipeline') {
          target.DD_GITHUB_JOB_NAME = ciEnv.DD_GITHUB_JOB_NAME
        }
        if (index !== undefined) {
          target.DD_GITHUB_STEP_INDEX = String(index)
        }
        const key = JSON.stringify([record.type, level, target])
        const patch = patches.get(key) || {
          type: record.type,
          level,
          ciEnv: target,
          values: {},
        }
        Object.assign(patch.values, record.type === 'tags' ? record.tags : record.measures)
        patches.set(key, patch)
      }
    }
  }
  for (const patch of patches.values()) {
    const tags = patch.type === 'tags'
    requests.push({
      method: 'POST',
      url: tags ? datadogRoute('/api/v2/ci/pipeline/tags') : datadogRoute('/api/v2/ci/pipeline/metrics'),
      data: {
        data: {
          type: tags ? 'ci_custom_tag' : 'ci_custom_metric',
          attributes: {
            ci_env: patch.ciEnv,
            ci_level: levels[patch.level],
            provider: 'github',
            ...(tags
              ? {tags: cleanTags(patch.values as Record<string, string>)}
              : {metrics: cleanMeasures(patch.values as Record<string, number>)}),
          },
        },
      },
    })
  }

  return {requests, skipped}
}
