import {setTimeout as delay} from 'node:timers/promises'

import type {UploadRequest} from './payloads'
import type {FlushResult, UploadOptions} from './types'

import {httpRequest, TransportError} from './request'
import {warn} from './validation'

export const upload = async (
  requests: UploadRequest[],
  options: UploadOptions = {}
): Promise<FlushResult & {completedIds: string[]}> => {
  const result = {sent: 0, failed: 0, skipped: 0, completedIds: [] as string[]}
  if (!requests.length) {
    return result
  }
  const apiKey = options.apiKey || process.env.DATADOG_API_KEY || process.env.DD_API_KEY
  const site = options.site || process.env.DATADOG_SITE || process.env.DD_SITE || 'datadoghq.com'
  const timeoutMs = options.timeoutMs ?? 10_000
  const requestTimeoutMs = options.requestTimeoutMs ?? 4_000
  if (
    !apiKey ||
    !/^(?:[a-z0-9-]+\.)*(?:datadoghq\.(?:com|eu)|ddog-gov\.com|datad0g\.com)$/.test(site) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1
  ) {
    warn(options.onWarning, 'Upload skipped: missing API key, unsupported site, or invalid timeout')
    result.skipped = requests.length

    return result
  }
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), timeoutMs)
  const failedIds = new Set<string>()
  const sentIds = new Set<string>()
  let next = 0
  try {
    await Promise.all(
      Array.from({length: Math.min(4, requests.length)}, async () => {
        while (!controller.signal.aborted && next < requests.length) {
          const item = requests[next++]
          let success = false
          try {
            for (let attempt = 0; ; attempt++) {
              const status = await httpRequest({
                url: item.url,
                site,
                apiKey,
                signal: controller.signal,
                timeoutMs: requestTimeoutMs,
                data: item.data,
              })
              if (status >= 200 && status < 300) {
                success = true
                break
              }
              if ((status !== 429 && status < 500) || attempt === 2) {
                break
              }
              await delay(250 * 2 ** attempt, undefined, {signal: controller.signal})
            }
          } catch (error) {
            if (error instanceof TransportError) {
              controller.abort()
            }
          }
          if (success) {
            result.sent++
            item.recordIds.forEach((id) => sentIds.add(id))
          } else {
            result.failed++
            item.recordIds.forEach((id) => failedIds.add(id))
          }
        }
      })
    )
  } finally {
    clearTimeout(deadline)
  }
  for (const item of requests.slice(next)) {
    item.recordIds.forEach((id) => failedIds.add(id))
  }
  result.skipped = requests.length - result.sent - result.failed
  result.completedIds = [...sentIds].filter((id) => !failedIds.has(id))
  if (result.failed || result.skipped) {
    warn(
      options.onWarning,
      `Upload incomplete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`
    )
  }

  return result
}
