import {RuntimeType} from '../constants'

const UNIVERSAL_INSTRUMENT_JAVA_EXTENSION_VERSION = 24
const UNIVERSAL_INSTRUMENT_JAVA_TRACE_VERSION = 5
const UNIVERSAL_INSTRUMENT_DOTNET_EXTENSION_VERSION = 24
const UNIVERSAL_INSTRUMENT_DOTNET_TRACE_VERSION = 4

export const isExtensionSupportUniversalInstrumentation = (
  runtimeType: RuntimeType,
  extensionVersion?: number
): boolean => {
  if (extensionVersion === undefined) {
    return false
  }
  switch (runtimeType) {
    case RuntimeType.JAVA:
      return extensionVersion >= UNIVERSAL_INSTRUMENT_JAVA_EXTENSION_VERSION
    case RuntimeType.DOTNET:
      return extensionVersion >= UNIVERSAL_INSTRUMENT_DOTNET_EXTENSION_VERSION
    default:
      return true
  }
}

export const isExtensionCompatibleWithTrace = (runtimeType: RuntimeType, traceVersion?: number): boolean => {
  // More complex compatbility rules can be configured for each extension version if necessary
  if (traceVersion === undefined) {
    return true
  }
  switch (runtimeType) {
    case RuntimeType.JAVA:
      return traceVersion >= UNIVERSAL_INSTRUMENT_JAVA_TRACE_VERSION
    case RuntimeType.DOTNET:
      return traceVersion >= UNIVERSAL_INSTRUMENT_DOTNET_TRACE_VERSION
    default:
      return true
  }
}
