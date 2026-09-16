export const TRACER_CONTAINER_NAME = 'datadog-tracer'
export const TRACER_VOLUME_NAME = 'datadog-tracer'
export const TRACER_MOUNT_PATH = '/datadog-lib'

/** The entrypoint every tracer image exposes, which copies the tracer into the path it is given. */
export const TRACER_COPY_ENTRYPOINT = '/datadog-init/copy-lib.sh'

/** The resource tag or label recording which injection mode instrumentation wrote, read by the serverless crawler. */
export const SSI_INJECTION_MODE_TAG = 'dd_sls_injection_mode'
export const SINGLE_LANGUAGE_SSI_MODE = 'single_language'
export const MULTI_LANGUAGE_SSI_MODE = 'multi_language'

export const TRACER_READINESS_PORT = 18999
export const TRACER_VOLUME_SIZE_LIMIT = '500Mi'
