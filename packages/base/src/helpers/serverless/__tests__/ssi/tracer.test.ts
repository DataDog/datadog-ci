import {
  SINGLE_LANGUAGE_TRACER_REGISTRIES,
  buildSingleLanguageTracerImage,
  getTracerCopyCompletionMarker,
  type Language,
  type SingleLanguageTracerRegistry,
  type TracerLanguage,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

const languageCases: {
  language: Language
  tracerLanguage: TracerLanguage
  repository: string
}[] = [
  {language: 'java', tracerLanguage: 'java', repository: 'dd-trace-java'},
  {language: 'nodejs', tracerLanguage: 'js', repository: 'dd-trace-js'},
  {language: 'csharp', tracerLanguage: 'dotnet', repository: 'dd-trace-dotnet'},
  {language: 'python', tracerLanguage: 'python', repository: 'dd-trace-py'},
  {language: 'ruby', tracerLanguage: 'ruby', repository: 'dd-trace-rb'},
  {language: 'php', tracerLanguage: 'php', repository: 'dd-trace-php'},
]

describe('language and image metadata', () => {
  test.each(
    SINGLE_LANGUAGE_TRACER_REGISTRIES.flatMap((registry) =>
      languageCases.map(({language, tracerLanguage}) => ({registry, language, tracerLanguage}))
    )
  )('builds the $registry $tracerLanguage image for $language', ({registry, language, tracerLanguage}) => {
    expect(buildSingleLanguageTracerImage(registry, language, '1.2.3')).toBe(
      `${registry}/dd-lib-${tracerLanguage}-init:1.2.3`
    )
  })

  test.each(languageCases)('builds the $repository completion marker for $language', ({language, repository}) => {
    expect(getTracerCopyCompletionMarker(language, '/datadog-lib')).toBe(`/datadog-lib/.${repository}-copy-finished`)
  })

  test.each(['go', 'toString', 'constructor', '__proto__'])(
    'rejects unsupported language %p at runtime',
    (language) => {
      expect(() => buildSingleLanguageTracerImage('gcr.io/datadoghq', language as Language, 'latest')).toThrow(
        'Unsupported language'
      )
    }
  )

  test.each(['docker.io/datadog', 'gcr.io/datadoghq/', '', ' public.ecr.aws/datadog'])(
    'rejects registry %p',
    (registry) => {
      expect(() => buildSingleLanguageTracerImage(registry as SingleLanguageTracerRegistry, 'java', 'latest')).toThrow(
        'Unsupported tracer registry'
      )
    }
  )

  test.each(['', ' ', '/', '1/2', 'latest:debug', '.latest', `a${'b'.repeat(128)}`, undefined])(
    'rejects malformed version %p',
    (version) => {
      expect(() => buildSingleLanguageTracerImage('gcr.io/datadoghq', 'java', version as string)).toThrow(
        'Invalid tracer version'
      )
    }
  )
})
