/** The SDK only sends to these CI Visibility intakes. */
export const DATADOG_ROUTE_PATHS = [
  '/api/intake/ci/custom_spans',
  '/api/v2/ci/pipeline/metrics',
  '/api/v2/ci/pipeline/tags',
] as const

export type DatadogRoute = (typeof DATADOG_ROUTE_PATHS)[number]

export const datadogRoute = (route: DatadogRoute): DatadogRoute => route
