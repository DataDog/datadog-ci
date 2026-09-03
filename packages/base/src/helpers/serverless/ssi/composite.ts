import type {EnvFragment} from './env'
import type {TracerRegistry} from './tracer'

export const COMPOSITE_TRACER_MOUNT_PATH = '/opt/datadog-packages'
export const COMPOSITE_TRACER_COMPLETION_MARKER = `${COMPOSITE_TRACER_MOUNT_PATH}/.datadog-composite-copy-finished`

export interface CompositeInjectionSpec {
  readonly image: string
  readonly mountPath: string
  readonly completionMarker: string
  readonly env: readonly EnvFragment[]
}

/** Builds the shared composite image and activation contract for a cloud registry. */
export const getCompositeInjectionSpec = (registry: TracerRegistry): CompositeInjectionSpec => ({
  image: `${registry}/dd-lib-composite-init:latest`,
  mountPath: COMPOSITE_TRACER_MOUNT_PATH,
  completionMarker: COMPOSITE_TRACER_COMPLETION_MARKER,
  env: [
    {
      name: 'LD_PRELOAD',
      value: `${COMPOSITE_TRACER_MOUNT_PATH}/datadog-apm-inject/stable/inject/launcher.preload.so`,
      separator: ' ',
      mode: 'prepend',
    },
    {name: 'DD_INJECT_SENDER_TYPE', value: 'serverless', mode: 'set-if-absent'},
  ],
})
