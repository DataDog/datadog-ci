import {
  SINGLE_LANGUAGE_TRACER_REGISTRIES,
  buildSingleLanguageTracerImage,
  normalizeServerlessLanguage,
  type CanonicalTracerLanguage,
  type ServerlessLanguage,
  type SingleLanguageTracerRegistry,
} from '@datadog/datadog-ci-base/helpers/serverless/ssi/tracer'

const languageCases: {
  language: ServerlessLanguage
  canonical: CanonicalTracerLanguage
}[] = [
  {language: 'java', canonical: 'java'},
  {language: 'nodejs', canonical: 'js'},
  {language: 'csharp', canonical: 'dotnet'},
  {language: 'python', canonical: 'python'},
  {language: 'ruby', canonical: 'ruby'},
  {language: 'php', canonical: 'php'},
]

describe('language and image metadata', () => {
  test.each(languageCases)('normalizes $language to $canonical', ({language, canonical}) => {
    expect(normalizeServerlessLanguage(language)).toBe(canonical)
  })

  test('rejects an unsupported language at runtime', () => {
    expect(() => normalizeServerlessLanguage('go' as ServerlessLanguage)).toThrow('Unsupported serverless language')
  })

  test.each(
    SINGLE_LANGUAGE_TRACER_REGISTRIES.flatMap((registry) => languageCases.map(({canonical}) => ({registry, canonical})))
  )('builds the $registry $canonical image', ({registry, canonical}) => {
    expect(buildSingleLanguageTracerImage(registry, canonical, '1.2.3')).toBe(
      `${registry}/dd-lib-${canonical}-init:1.2.3`
    )
  })

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

  test('rejects an unsupported canonical language at runtime', () => {
    expect(() =>
      buildSingleLanguageTracerImage('gcr.io/datadoghq', 'nodejs' as CanonicalTracerLanguage, 'latest')
    ).toThrow('Unsupported canonical tracer language')
  })
})
