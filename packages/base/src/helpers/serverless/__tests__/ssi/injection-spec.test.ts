import {mergeEnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  getLanguageCompatibilityErrors,
  getLanguageInjectionSpec,
  type Libc,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'
import {LANGUAGE_METADATA, type Language} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

const languages = Object.keys(LANGUAGE_METADATA) as Language[]

const getSpec = (language: Language, libc: Libc = 'glibc') =>
  getLanguageInjectionSpec({
    language,
    libc,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
  })

describe('injection specification metadata and root', () => {
  test.each(languages)('returns the %s tracer image', (language) => {
    expect(getSpec(language).image).toBe(
      `gcr.io/datadoghq/dd-lib-${LANGUAGE_METADATA[language].tracerLanguage}-init:latest`
    )
  })

  test('uses a configurable normalized tracer root', () => {
    const spec = getLanguageInjectionSpec({
      language: 'java',
      libc: 'glibc',
      registry: 'public.ecr.aws/datadog',
      version: 'v1',
      root: '/opt/datadog/',
    })
    expect(spec.artifacts).toEqual([['/opt/datadog/dd-java-agent.jar']])
    expect(spec.env[0].value).toContain('/opt/datadog/dd-java-agent.jar')
  })

  test('supports the filesystem root without producing double slashes', () => {
    const spec = getLanguageInjectionSpec({
      language: 'python',
      libc: 'glibc',
      registry: 'gcr.io/datadoghq',
      version: 'latest',
      root: '/',
    })
    expect(spec.artifacts).toEqual([['/sitecustomize.py']])
    expect(spec.env[0].value).toBe('/')
  })
})

describe('language injection specifications', () => {
  test('keeps Java options runtime-agnostic when the runtime version is unknown', () => {
    const spec = getSpec('java', 'musl')
    expect(spec.artifacts).toEqual([['/datadog-lib/dd-java-agent.jar']])
    expect(spec.env).toEqual([
      {
        name: 'JAVA_TOOL_OPTIONS',
        value: '-javaagent:/datadog-lib/dd-java-agent.jar -XX:+IgnoreUnrecognizedVMOptions',
        separator: ' ',
        mode: 'append',
      },
    ])
    expect(spec.env[0].value).not.toContain('enable-native-access')
  })

  test.each(['glibc', 'musl'] as const)('Node package self-selects for %s', (libc) => {
    const spec = getSpec('nodejs', libc)
    expect(spec.artifacts).toEqual([['/datadog-lib/node_modules/dd-trace/init.js']])
    expect(spec.env).toEqual([
      {
        name: 'NODE_OPTIONS',
        value: '--require /datadog-lib/node_modules/dd-trace/init.js',
        separator: ' ',
        mode: 'append',
      },
    ])
  })

  test.each(['glibc', 'musl'] as const)('Python package self-selects for %s', (libc) => {
    const spec = getSpec('python', libc)
    expect(spec.artifacts).toEqual([['/datadog-lib/sitecustomize.py']])
    expect(spec.env).toEqual([
      {
        name: 'PYTHONPATH',
        value: '/datadog-lib',
        separator: ':',
        mode: 'append',
      },
    ])
  })

  test('requires the Ruby bootstrap referenced by RUBYOPT', () => {
    const spec = getSpec('ruby')
    expect(spec.artifacts).toEqual([['/datadog-lib/auto_inject.rb']])
    expect(spec.env).toEqual([
      {
        name: 'RUBYOPT',
        value: '-r/datadog-lib/auto_inject',
        separator: ' ',
        mode: 'prepend',
      },
    ])
  })

  test('reports Ruby on musl as incompatible', () => {
    expect(getLanguageCompatibilityErrors({language: 'ruby', libc: 'musl', version: 'latest'})).toEqual([
      expect.stringContaining('does not support musl'),
    ])
  })

  test.each([
    {libc: 'glibc' as const, platform: 'linux-gnu'},
    {libc: 'musl' as const, platform: 'linux-musl'},
  ])('selects PHP $platform files and config for $libc', ({libc, platform}) => {
    const spec = getSpec('php', libc)
    const loader = `/datadog-lib/${platform}/loader`
    expect(spec.artifacts).toEqual([[`${loader}/dd_library_loader.ini`], [`${loader}/dd_library_loader.so`]])
    expect(spec.env).toEqual([
      {
        name: 'PHP_INI_SCAN_DIR',
        value: loader,
        separator: ':',
        mode: 'append',
        preserveLeadingEmpty: true,
      },
      {name: 'DD_LOADER_PACKAGE_PATH', value: '/datadog-lib', mode: 'set-if-absent'},
    ])
    expect(mergeEnvFragment(undefined, spec.env[0])).toBe(`:${loader}`)
    expect(mergeEnvFragment('/etc/php/conf.d', spec.env[0])).toBe(`/etc/php/conf.d:${loader}`)
  })

  test.each(['2.56.0', 'v2.60.1'])('reports .NET 2.x layouts as incompatible', (version) => {
    expect(getLanguageCompatibilityErrors({language: 'csharp', libc: 'glibc', version})).toEqual([
      expect.stringContaining('versions before 3.0 require architecture-specific package paths'),
    ])
  })

  test.each(['glibc', 'musl'] as const)('uses the current universal .NET package paths for %s', (libc) => {
    const spec = getSpec('csharp', libc)
    expect(spec.artifacts).toEqual([
      ['/datadog-lib/Datadog.Trace.ClrProfiler.Native.so'],
      ['/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'],
    ])
    expect(spec.env).toEqual([
      {name: 'CORECLR_ENABLE_PROFILING', value: '1', mode: 'set-if-absent'},
      {
        name: 'CORECLR_PROFILER',
        value: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        mode: 'set-if-absent',
      },
      {
        name: 'CORECLR_PROFILER_PATH',
        value: '/datadog-lib/Datadog.Trace.ClrProfiler.Native.so',
        mode: 'set-if-absent',
      },
      {name: 'DD_DOTNET_TRACER_HOME', value: '/datadog-lib', mode: 'set-if-absent'},
      {
        name: 'LD_PRELOAD',
        value: '/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so',
        separator: ' ',
        mode: 'prepend',
        maxLength: 1024,
      },
    ])
  })

  test('accepts compatible language options', () => {
    expect(getLanguageCompatibilityErrors({language: 'java', libc: 'musl', version: 'latest'})).toEqual([])
    expect(getLanguageCompatibilityErrors({language: 'csharp', libc: 'glibc', version: '3.0.0'})).toEqual([])
  })
})
