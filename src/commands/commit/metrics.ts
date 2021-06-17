import metrics from 'datadog-metrics'
import {apiHost} from './api'

export interface MetricsLogger {
  logger: metrics.BufferedMetricsLogger
  flush(): Promise<void>
}

export const getMetricsLogger = (cliVersion: string): MetricsLogger => {
  const logger = new metrics.BufferedMetricsLogger({
    apiHost,
    defaultTags: [`cli_version:${cliVersion}`],
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'datadog.ci.report-commits.',
  })

  return {
    flush: () =>
      new Promise((resolve, reject) => {
        logger.flush(resolve, (err) => reject(new Error(`Could not flush metrics to ${apiHost}: ${err}`)))
      }),
    logger,
  }
}
