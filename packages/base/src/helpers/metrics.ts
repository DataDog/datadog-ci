import {BufferedMetricsLogger} from 'datadog-metrics'

import {getDatadogSite} from './api'

export interface MetricsLogger {
  logger: BufferedMetricsLogger
  flush(): Promise<void>
}

export interface MetricsLoggerOptions {
  apiKey?: string
  datadogSite?: string
  defaultTags?: string[]
  prefix: string
}

export const getMetricsLogger = (opts: MetricsLoggerOptions): MetricsLogger => {
  const apiUrl = 'api.' + getDatadogSite(opts.datadogSite)

  const logger = new BufferedMetricsLogger({
    apiKey: opts.apiKey,
    site: opts.datadogSite,
    defaultTags: opts.defaultTags,
    flushIntervalSeconds: 15,
    prefix: opts.prefix,
  })

  return {
    flush: async () => {
      try {
        await logger.flush()
      } catch (error) {
        throw new Error(`Could not flush metrics to ${apiUrl}: ${error}`)
      }
    },
    logger,
  }
}
