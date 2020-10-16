import metrics from 'datadog-metrics'

export const getMetricsLogger = (service: string, version?: string): metrics.BufferedMetricsLogger => {
  const defaultTags = [`service:${service}`]
  if (version) {
    defaultTags.push(`version:${version}`)
  }

  return new metrics.BufferedMetricsLogger({
    defaultTags,
    flushIntervalSeconds: 15,
    host: 'ci',
    prefix: 'datadog.ci.dependencies.',
  })
}
