import {RuntimeType} from '../constants'

const UNIVERSAL_INSTRUMENTATION_JAVA_EXTENSION_VERSION = 24
const UNIVERSAL_INSTRUMENTATION_JAVA_TRACER_VERSION = 5
const UNIVERSAL_INSTRUMENTATION_DOTNET_EXTENSION_VERSION = 24
const UNIVERSAL_INSTRUMENTATION_DOTNET_TRACER_VERSION = 4

export const isExtensionCompatibleWithUniversalInstrumentation = (
  runtimeType: RuntimeType,
  extensionVersion?: number
): boolean => {
  if (extensionVersion === undefined) {
    return false
  }
  switch (runtimeType) {
    case RuntimeType.JAVA:
      return extensionVersion >= UNIVERSAL_INSTRUMENTATION_JAVA_EXTENSION_VERSION
    case RuntimeType.DOTNET:
      return extensionVersion >= UNIVERSAL_INSTRUMENTATION_DOTNET_EXTENSION_VERSION
    default:
      return true
  }
}

export const isTracerCompatibleWithExtension = (runtimeType: RuntimeType, traceVersion?: number): boolean => {
  // More complex compatbility rules can be configured for each extension version if necessary
  if (traceVersion === undefined) {
    return true
  }
  switch (runtimeType) {
    case RuntimeType.JAVA:
      return traceVersion >= UNIVERSAL_INSTRUMENTATION_JAVA_TRACER_VERSION
    case RuntimeType.DOTNET:
      return traceVersion >= UNIVERSAL_INSTRUMENTATION_DOTNET_TRACER_VERSION
    default:
      return true
  }
}
