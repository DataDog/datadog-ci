/**
 * List of all Datadog API routes used by datadog-ci.
 *
 * Only those routes are accepted by {@link datadogRoute}.
 */
export const DATADOG_ROUTE_PATHS = [
  '/api/intake/ci/custom_spans',
  '/api/ui/support/serverless/flare',
  '/api/unstable/deployments/gates/evaluation',
  '/api/unstable/deployments/gates/evaluation/:evaluationId',
  '/api/v1/validate',
  '/api/v2/ci/deployments/correlate-image',
  '/api/v2/ci/deployments/correlate',
  '/api/v2/ci/pipeline/metrics',
  '/api/v2/ci/pipeline/tags',
  '/api/v2/cicodescan',
  '/api/v2/cicovreprt',
  '/api/v2/ciiac',
  '/api/v2/cireport',
  '/api/v2/dora/deployment',
  '/api/v2/git/repository/packfile',
  '/api/v2/git/repository/search_commits',
  '/api/v2/quality-gates/evaluate',
  '/api/v2/srcmap',
  '/api/v2/static-analysis-sca/dependencies',
  '/synthetics/ci/batch/:batchId',
  '/synthetics/ci/tunnel',
  '/synthetics/mobile/applications/:applicationId/multipart-presigned-urls',
  '/synthetics/mobile/applications/:applicationId/multipart-upload-complete',
  '/synthetics/mobile/applications/validation-job-status/:jobId',
  '/synthetics/settings',
  '/synthetics/tests/:testId',
  '/synthetics/tests/:testId/version_history/:version?only_check_existence=true',
  '/synthetics/tests/:testType/:testId',
  '/synthetics/tests/poll_results',
  '/synthetics/tests/search',
  '/synthetics/tests/trigger/ci',
  '/v1/input',
] as const

/**
 * Format a Datadog API route with optional parameters.
 *
 * @example
 * ```ts
 * const route = datadogRoute('/api/v2/resources/:resourceId', {
 *   resourceId: '123',
 * })
 * ```
 */
export const datadogRoute = <Route extends DatadogRoutePath>(
  route: Route,
  ...[params]: DatadogRouteArgs<Route>
): DatadogRoute<Route> => {
  if (!params) {
    return route as DatadogRoute<Route>
  }

  return route.replace(/:([A-Za-z0-9_]+)/g, (_, key: keyof DatadogRouteParams<Route>) =>
    encodeURIComponent(String(params[key]))
  ) as DatadogRoute<Route>
}

export type DatadogRoute<Route extends string = string> = Route & {[datadogRouteBrand]: true}

type DatadogRoutePath = (typeof DATADOG_ROUTE_PATHS)[number]

declare const datadogRouteBrand: unique symbol

type RouteParamNames<Route extends string> = Route extends `${string}:${infer Param}/${infer Rest}`
  ? Param | RouteParamNames<Rest>
  : Route extends `${string}:${infer Param}?${infer Rest}`
    ? Param | RouteParamNames<Rest>
    : Route extends `${string}:${infer Param}`
      ? Param
      : never

type DatadogRouteParams<Route extends DatadogRoutePath> = {
  [Param in RouteParamNames<Route>]: string | number
}

type DatadogRouteArgs<Route extends DatadogRoutePath> =
  RouteParamNames<Route> extends never ? [] : [params: DatadogRouteParams<Route>]
