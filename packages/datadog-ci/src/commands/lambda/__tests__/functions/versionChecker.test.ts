import {RuntimeType} from '../../constants'
import {
  isExtensionCompatibleWithUniversalInstrumentation,
  isTracerCompatibleWithExtension,
} from '../../functions/versionChecker'

describe('Test extension and trace version checker', () => {
  test.each`
    runtimeType           | extensionVersion | result
    ${RuntimeType.JAVA}   | ${27}            | ${true}
    ${RuntimeType.JAVA}   | ${23}            | ${false}
    ${RuntimeType.JAVA}   | ${undefined}     | ${false}
    ${RuntimeType.DOTNET} | ${27}            | ${true}
    ${RuntimeType.DOTNET} | ${23}            | ${false}
    ${RuntimeType.DOTNET} | ${undefined}     | ${false}
    ${RuntimeType.NODE}   | ${27}            | ${true}
    ${RuntimeType.PYTHON} | ${23}            | ${true}
  `(
    'should function isExtensionSupportUniversalInstrumentation() return $result if runtimeType=$runtimeType and extensionVersion=$extensionVersion',
    ({runtimeType, extensionVersion, result}) => {
      expect(isExtensionCompatibleWithUniversalInstrumentation(runtimeType, extensionVersion)).toEqual(result)
    }
  )

  test.each`
    runtimeType           | traceVersion | result
    ${RuntimeType.JAVA}   | ${5}         | ${true}
    ${RuntimeType.JAVA}   | ${4}         | ${false}
    ${RuntimeType.JAVA}   | ${undefined} | ${true}
    ${RuntimeType.DOTNET} | ${3}         | ${false}
    ${RuntimeType.DOTNET} | ${4}         | ${true}
    ${RuntimeType.DOTNET} | ${undefined} | ${true}
    ${RuntimeType.NODE}   | ${8}         | ${true}
    ${RuntimeType.PYTHON} | ${2}         | ${true}
  `(
    'should function isExtensionCompatibleWithTrace() return $result if runtimeType=$runtimeType and traceVersion=$traceVersion',
    ({runtimeType, traceVersion, result}) => {
      expect(isTracerCompatibleWithExtension(runtimeType, traceVersion)).toEqual(result)
    }
  )
})
