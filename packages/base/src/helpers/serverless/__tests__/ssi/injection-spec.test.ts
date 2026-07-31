import type {CanonicalTracerLanguage, ServerlessLanguage} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

import {mergeEnvFragment} from '@datadog/datadog-ci-base/helpers/serverless/ssi/env'
import {
  getSingleLanguageInjectionSpec,
  type ServerlessLibc,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/injection-spec'

const languageCases: {
  language: ServerlessLanguage
  canonical: CanonicalTracerLanguage
  repository: string
}[] = [
  {language: 'java', canonical: 'java', repository: 'dd-trace-java'},
  {language: 'nodejs', canonical: 'js', repository: 'dd-trace-js'},
  {language: 'csharp', canonical: 'dotnet', repository: 'dd-trace-dotnet'},
  {language: 'python', canonical: 'python', repository: 'dd-trace-py'},
  {language: 'ruby', canonical: 'ruby', repository: 'dd-trace-rb'},
  {language: 'php', canonical: 'php', repository: 'dd-trace-php'},
]

const getSpec = (language: ServerlessLanguage, libc: ServerlessLibc = 'glibc') =>
  getSingleLanguageInjectionSpec({
    language,
    libc,
    registry: 'gcr.io/datadoghq',
    version: 'latest',
  })

describe('injection specification metadata and root', () => {
  test.each(languageCases)(
    'returns image and repository metadata for $language',
    ({language, canonical, repository}) => {
      const spec = getSpec(language)
      expect(spec).toMatchObject({
        language,
        canonicalLanguage: canonical,
        repository,
        image: `gcr.io/datadoghq/dd-lib-${canonical}-init:latest`,
      })
    }
  )

  test('uses a configurable normalized tracer root', () => {
    const spec = getSingleLanguageInjectionSpec({
      language: 'java',
      libc: 'glibc',
      registry: 'public.ecr.aws/datadog',
      version: 'v1',
      root: '/opt/datadog/',
    })
    expect(spec.requiredFiles).toEqual([['/opt/datadog/dd-java-agent.jar']])
    expect(spec.env[0].value).toContain('/opt/datadog/dd-java-agent.jar')
  })

  test('supports the filesystem root without producing double slashes', () => {
    const spec = getSingleLanguageInjectionSpec({
      language: 'python',
      libc: 'glibc',
      registry: 'gcr.io/datadoghq',
      version: 'latest',
      root: '/',
    })
    expect(spec.requiredFiles).toEqual([['/sitecustomize.py']])
    expect(spec.env[0].value).toBe('/')
  })

  test.each(['', 'relative', '/path with-space', '/opt/../datadog', '/opt//datadog'])(
    'rejects malformed root %p',
    (root) => {
      expect(() =>
        getSingleLanguageInjectionSpec({
          language: 'java',
          libc: 'glibc',
          registry: 'gcr.io/datadoghq',
          version: 'latest',
          root,
        })
      ).toThrow('Tracer root')
    }
  )
})

describe('language injection specifications', () => {
  test('keeps Java options runtime-agnostic when the runtime version is unknown', () => {
    const spec = getSpec('java', 'musl')
    expect(spec.requiredFiles).toEqual([['/datadog-lib/dd-java-agent.jar']])
    expect(spec.env).toEqual([
      {
        name: 'JAVA_TOOL_OPTIONS',
        value: '-javaagent:/datadog-lib/dd-java-agent.jar -XX:+IgnoreUnrecognizedVMOptions',
        separator: ' ',
        direction: 'append',
      },
    ])
    expect(spec.env[0].value).not.toContain('enable-native-access')
  })

  test.each(['glibc', 'musl'] as const)('Node package self-selects for %s', (libc) => {
    const spec = getSpec('nodejs', libc)
    expect(spec.requiredFiles).toEqual([['/datadog-lib/node_modules/dd-trace/init.js']])
    expect(spec.env).toEqual([
      {
        name: 'NODE_OPTIONS',
        value: '--require /datadog-lib/node_modules/dd-trace/init.js',
        separator: ' ',
        direction: 'append',
      },
    ])
  })

  test.each(['glibc', 'musl'] as const)('Python package self-selects for %s', (libc) => {
    const spec = getSpec('python', libc)
    expect(spec.requiredFiles).toEqual([['/datadog-lib/sitecustomize.py']])
    expect(spec.env).toEqual([
      {
        name: 'PYTHONPATH',
        value: '/datadog-lib',
        separator: ':',
        direction: 'append',
      },
    ])
  })

  test('requires the Ruby bootstrap referenced by RUBYOPT', () => {
    const spec = getSpec('ruby')
    expect(spec.requiredFiles).toEqual([['/datadog-lib/auto_inject.rb']])
    expect(spec.env).toEqual([
      {
        name: 'RUBYOPT',
        value: '-r/datadog-lib/auto_inject',
        separator: ' ',
        direction: 'prepend',
      },
    ])
  })

  test('rejects Ruby on musl', () => {
    expect(() => getSpec('ruby', 'musl')).toThrow('does not support musl')
  })

  test.each([
    {libc: 'glibc' as const, platform: 'linux-gnu'},
    {libc: 'musl' as const, platform: 'linux-musl'},
  ])('selects PHP $platform files and config for $libc', ({libc, platform}) => {
    const spec = getSpec('php', libc)
    const loader = `/datadog-lib/${platform}/loader`
    expect(spec.requiredFiles).toEqual([[`${loader}/dd_library_loader.ini`], [`${loader}/dd_library_loader.so`]])
    expect(spec.env).toEqual([
      {name: 'PHP_INI_SCAN_DIR', value: `:${loader}`, direction: 'append'},
      {name: 'DD_LOADER_PACKAGE_PATH', value: '/datadog-lib', direction: 'set-if-absent'},
    ])
    expect(mergeEnvFragment(undefined, spec.env[0])).toBe(`:${loader}`)
    expect(mergeEnvFragment('/etc/php/conf.d', spec.env[0])).toBe(`/etc/php/conf.d:${loader}`)
  })

  test.each(['2.56.0', 'v2.60.1'])('rejects pinned .NET 2.x layouts that require architecture', (version) => {
    expect(() =>
      getSingleLanguageInjectionSpec({
        language: 'csharp',
        libc: 'glibc',
        registry: 'gcr.io/datadoghq',
        version,
      })
    ).toThrow('versions before 3.0 require architecture-specific package paths')
  })

  test.each(['glibc', 'musl'] as const)('uses the current universal .NET package paths for %s', (libc) => {
    const spec = getSpec('csharp', libc)
    expect(spec.requiredFiles).toEqual([
      ['/datadog-lib/Datadog.Trace.ClrProfiler.Native.so'],
      ['/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so'],
    ])
    expect(spec.env).toEqual([
      {name: 'CORECLR_ENABLE_PROFILING', value: '1', direction: 'set-if-absent'},
      {
        name: 'CORECLR_PROFILER',
        value: '{846F5F1C-F9AE-4B07-969E-05C26BC060D8}',
        direction: 'set-if-absent',
      },
      {
        name: 'CORECLR_PROFILER_PATH',
        value: '/datadog-lib/Datadog.Trace.ClrProfiler.Native.so',
        direction: 'set-if-absent',
      },
      {name: 'DD_DOTNET_TRACER_HOME', value: '/datadog-lib', direction: 'set-if-absent'},
      {
        name: 'LD_PRELOAD',
        value: '/datadog-lib/continuousprofiler/Datadog.Linux.ApiWrapper.x64.so',
        separator: ' ',
        direction: 'prepend',
        maxLength: 1024,
      },
    ])
  })

  test('rejects an invalid libc at runtime', () => {
    expect(() => getSpec('java', 'uclibc' as ServerlessLibc)).toThrow('Unsupported libc')
  })
})
