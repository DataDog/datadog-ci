import {setTimeout as delay} from 'node:timers/promises'

import type {UploadRequest} from './payloads'
import type {Environment, FlushResult, UploadOptions} from './types'

import {httpRequest, TransportError} from './request'
import {warn} from './validation'

export const upload = async (
  requests: UploadRequest[],
  options: UploadOptions = {},
  env: Environment = process.env
): Promise<FlushResult> => {
  const result = {sent: 0, failed: 0, skipped: 0}
  if (!requests.length) {
    return result
  }
  const apiKey = options.apiKey || env.DATADOG_API_KEY || env.DD_API_KEY
  const site = options.site || env.DATADOG_SITE || env.DD_SITE || 'datadoghq.com'
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
    warn(options.onWarning, 'Upload skipped: missing API key, unsupported site, or invalid timeout', env)
    result.skipped = requests.length

    return result
  }
  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), timeoutMs)
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
          } else {
            result.failed++
          }
        }
      })
    )
  } finally {
    clearTimeout(deadline)
  }
  result.skipped = requests.length - result.sent - result.failed
  if (result.failed || result.skipped) {
    warn(
      options.onWarning,
      `Upload incomplete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`,
      env
    )
  }

  return result
}
