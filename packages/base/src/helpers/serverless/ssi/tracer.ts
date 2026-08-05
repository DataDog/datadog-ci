export const SINGLE_LANGUAGE_TRACER_REGISTRIES = [
  'gcr.io/datadoghq',
  'public.ecr.aws/datadog',
  'datadoghq.azurecr.io',
] as const

export type SingleLanguageTracerRegistry = (typeof SINGLE_LANGUAGE_TRACER_REGISTRIES)[number]

export const LANGUAGE_METADATA = {
  java: {tracerLanguage: 'java', repository: 'dd-trace-java'},
  nodejs: {tracerLanguage: 'js', repository: 'dd-trace-js'},
  csharp: {tracerLanguage: 'dotnet', repository: 'dd-trace-dotnet'},
  python: {tracerLanguage: 'python', repository: 'dd-trace-py'},
  ruby: {tracerLanguage: 'ruby', repository: 'dd-trace-rb'},
  php: {tracerLanguage: 'php', repository: 'dd-trace-php'},
} as const

export type Language = keyof typeof LANGUAGE_METADATA
export type TracerLanguage = (typeof LANGUAGE_METADATA)[Language]['tracerLanguage']

const IMAGE_TAG_REG_EXP = /^[\w][\w.-]{0,127}$/

export const buildSingleLanguageTracerImage = (
  registry: SingleLanguageTracerRegistry,
  language: Language,
  version: string
): string => {
  if (!(SINGLE_LANGUAGE_TRACER_REGISTRIES as readonly string[]).includes(registry)) {
    throw new Error(`Unsupported tracer registry: ${String(registry)}`)
  }
  if (!Object.prototype.hasOwnProperty.call(LANGUAGE_METADATA, language)) {
    throw new Error(`Unsupported language: ${String(language)}`)
  }
  const metadata = LANGUAGE_METADATA[language]
  if (typeof version !== 'string' || !IMAGE_TAG_REG_EXP.test(version)) {
    throw new Error(`Invalid tracer version: ${JSON.stringify(version)}`)
  }

  return `${registry}/dd-lib-${metadata.tracerLanguage}-init:${version}`
}
