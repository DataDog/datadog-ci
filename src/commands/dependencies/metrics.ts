import metrics from 'datadog-metrics'

export interface MetricsLogger {
  logger: metrics.BufferedMetricsLogger
  flush(): Promise<void>
}

export const getMetricsLogger = (apiHost: string, service: string, version?: string): MetricsLogger => {
  // There is no direct option to set datadog api host other than environment variable
  process.env.DATADOG_API_HOST = apiHost

  const defaultTags = [`service:${service}`]
  if (version) {
    defaultTags.push(`version:${version}`)
  }

  const logger = new metrics.BufferedMetricsLogger({
    defaultTags,
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'datadog.ci.dependencies.',
  })

  return {
    flush: () =>
      new Promise((resolve, reject) => {
        logger.flush(resolve, (err) => reject(new Error(`Could not flush metrics to ${apiHost}: ${err}`)))
      }),
    logger,
  }
}
