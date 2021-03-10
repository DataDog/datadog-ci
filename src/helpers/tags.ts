// Context
export const PARENT_SPAN_ID = 'x-datadog-parent-id'
export const TRACE_ID = 'x-datadog-trace-id'

export const CI_ENV_PARENT_SPAN_ID = 'X_DATADOG_PARENT_ID'
export const CI_ENV_TRACE_ID = 'X_DATADOG_TRACE_ID'

// Build
export const CI_PIPELINE_URL = 'ci.pipeline.url'
export const CI_PROVIDER_NAME = 'ci.provider.name'
export const CI_LEVEL = '_dd.ci.level'
// @deprecated TODO: remove this once backend is updated
export const CI_BUILD_LEVEL = '_dd.ci.build_level'

// Git
export const GIT_BRANCH = 'git.branch'
export const GIT_SHA = 'git.commit.sha'

// General
export const SPAN_TYPE = 'span.type'
