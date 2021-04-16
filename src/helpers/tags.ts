// Context
export const PARENT_SPAN_ID = 'x-datadog-parent-id'
export const TRACE_ID = 'x-datadog-trace-id'

export const CI_ENV_PARENT_SPAN_ID = 'X_DATADOG_PARENT_ID'
export const CI_ENV_TRACE_ID = 'X_DATADOG_TRACE_ID'

// Build
export const CI_PIPELINE_URL = 'ci.pipeline.url'
export const CI_PROVIDER_NAME = 'ci.provider.name'
export const CI_PIPELINE_ID = 'ci.pipeline.id'
export const CI_PIPELINE_NAME = 'ci.pipeline.name'
export const CI_PIPELINE_NUMBER = 'ci.pipeline.number'
export const CI_WORKSPACE_PATH = 'ci.workspace_path'
export const GIT_REPOSITORY_URL = 'git.repository_url'
export const CI_JOB_URL = 'ci.job.url'
export const CI_JOB_NAME = 'ci.job.name'
export const CI_STAGE_NAME = 'ci.stage.name'
export const CI_LEVEL = '_dd.ci.level'
// @deprecated TODO: remove this once backend is updated
export const CI_BUILD_LEVEL = '_dd.ci.build_level'

// Git
export const GIT_BRANCH = 'git.branch'
export const GIT_SHA = 'git.commit.sha'

// General
export const SPAN_TYPE = 'span.type'
