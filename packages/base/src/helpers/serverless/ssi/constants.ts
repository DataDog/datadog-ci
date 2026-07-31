export const TRACER_COPY_CONTAINER_NAME = 'datadog-tracer-copy'
export const SSI_APP_CONTAINER_NAME = 'datadog-app'
export const TRACER_VOLUME_NAME = 'datadog-tracer'
export const TRACER_MOUNT_PATH = '/datadog-lib'
export const TRACER_READINESS_PORT = 18999

export const DEFAULT_TRACER_REGISTRY = 'gcr.io/datadoghq'
export const DEFAULT_TRACER_VERSION = 'latest'
export const DEFAULT_TRACER_LIBC = 'glibc'

export const DEFAULT_TRACER_VOLUME_SIZE = '768Mi'
export const DEFAULT_TRACER_SIDECAR_MEMORY = '1Gi'

export const SSI_ADOPTION_LABEL_NAME = 'dd_sls_injection_mode'
export const SSI_ADOPTION_LABEL_VALUE = 'single_language'
