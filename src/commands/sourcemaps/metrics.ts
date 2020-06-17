import metrics from 'datadog-metrics'

export const getMetricsLogger = (version: string, service: string): metrics.BufferedMetricsLogger =>
  new metrics.BufferedMetricsLogger({
    defaultTags: [`version:${version}`, `service:${service}`],
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'dd.datadog_ci.sourcemaps.',
  })
