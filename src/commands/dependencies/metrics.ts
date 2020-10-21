import metrics from 'datadog-metrics'

export const getMetricsLogger = (apiHost: string, service: string, version?: string): metrics.BufferedMetricsLogger => {
  // There is no direct option to set datadog api host other than environment variable
  process.env.DATADOG_API_HOST = apiHost

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
