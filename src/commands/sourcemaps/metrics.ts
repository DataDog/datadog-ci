import metrics from 'datadog-metrics'

export const getMetricsLogger = (version: string, service: string, cliVersion: string): metrics.BufferedMetricsLogger =>
  new metrics.BufferedMetricsLogger({
    defaultTags: [`version:${version}`, `service:${service}`, `cli_version:${cliVersion}`],
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'datadog.ci.sourcemaps.',
  })
