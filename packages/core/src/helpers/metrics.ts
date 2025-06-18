import metrics from 'datadog-metrics'
import {ProxyAgent} from 'proxy-agent'

export interface MetricsLogger {
  logger: metrics.BufferedMetricsLogger
  flush(): Promise<void>
}

export interface MetricsLoggerOptions {
  apiKey?: string
  datadogSite?: string
  defaultTags?: string[]
  prefix: string
}

export const getMetricsLogger = (opts: MetricsLoggerOptions): MetricsLogger => {
  const apiUrl = getBaseAPIUrl(opts.datadogSite)

  const metricsOpts = {
    // ProxyAgent will retrieve proxy agent from env vars when relevant
    // agent is not in the type definitions file but has been introduced in datadog-metrics 0.8.x
    agent: new ProxyAgent(),
    apiHost: apiUrl,
    apiKey: opts.apiKey,
    defaultTags: opts.defaultTags,
    flushIntervalSeconds: 15,
    prefix: opts.prefix,
  }

  const logger = new metrics.BufferedMetricsLogger(metricsOpts)

  return {
    flush: () =>
      new Promise((resolve, reject) => {
        logger.flush(resolve, (err) => reject(new Error(`Could not flush metrics to ${apiUrl}: ${err}`)))
      }),
    logger,
  }
}

const getBaseAPIUrl = (datadogSite?: string) => {
  if (datadogSite) {
    return 'api.' + datadogSite
  }

  return 'api.datadoghq.com'
}
