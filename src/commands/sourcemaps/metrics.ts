import metrics from 'datadog-metrics'
import {getBaseAPIUrl} from './utils'

export interface MetricsLogger {
  logger: metrics.BufferedMetricsLogger
  flush(): Promise<void>
}

export const getMetricsLogger = (version: string, service: string, cliVersion: string): MetricsLogger => {
  const logger = new metrics.BufferedMetricsLogger({
    apiHost: getBaseAPIUrl(),
    defaultTags: [`version:${version}`, `service:${service}`, `cli_version:${cliVersion}`],
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'datadog.ci.sourcemaps.',
  })

  return {
    flush: () =>
      new Promise((resolve, reject) => {
        logger.flush(resolve, (err) => reject(new Error(`Could not flush metrics to ${getBaseAPIUrl()}: ${err}`)))
      }),
    logger,
  }
}
