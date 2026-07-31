export const SINGLE_LANGUAGE_TRACER_REGISTRIES = [
  'gcr.io/datadoghq',
  'public.ecr.aws/datadog',
  'datadoghq.azurecr.io',
] as const

export type SingleLanguageTracerRegistry = (typeof SINGLE_LANGUAGE_TRACER_REGISTRIES)[number]
export type ServerlessLanguage = 'java' | 'nodejs' | 'csharp' | 'python' | 'ruby' | 'php'
export type CanonicalTracerLanguage = 'java' | 'js' | 'dotnet' | 'python' | 'ruby' | 'php'

export interface LanguageMetadata {
  canonicalLanguage: CanonicalTracerLanguage
  repository: string
}

export const LANGUAGE_METADATA: Record<ServerlessLanguage, LanguageMetadata> = {
  java: {canonicalLanguage: 'java', repository: 'dd-trace-java'},
  nodejs: {canonicalLanguage: 'js', repository: 'dd-trace-js'},
  csharp: {canonicalLanguage: 'dotnet', repository: 'dd-trace-dotnet'},
  python: {canonicalLanguage: 'python', repository: 'dd-trace-py'},
  ruby: {canonicalLanguage: 'ruby', repository: 'dd-trace-rb'},
  php: {canonicalLanguage: 'php', repository: 'dd-trace-php'},
}

const CANONICAL_TRACER_LANGUAGES: readonly CanonicalTracerLanguage[] = ['java', 'js', 'dotnet', 'python', 'ruby', 'php']
const IMAGE_TAG_REG_EXP = /^[\w][\w.-]{0,127}$/

export const normalizeServerlessLanguage = (language: ServerlessLanguage): CanonicalTracerLanguage => {
  const metadata = LANGUAGE_METADATA[language]
  if (!metadata) {
    throw new Error(`Unsupported serverless language: ${String(language)}`)
  }

  return metadata.canonicalLanguage
}

export const buildSingleLanguageTracerImage = (
  registry: SingleLanguageTracerRegistry,
  canonicalLanguage: CanonicalTracerLanguage,
  version: string
): string => {
  if (!(SINGLE_LANGUAGE_TRACER_REGISTRIES as readonly string[]).includes(registry)) {
    throw new Error(`Unsupported tracer registry: ${String(registry)}`)
  }
  if (!CANONICAL_TRACER_LANGUAGES.includes(canonicalLanguage)) {
    throw new Error(`Unsupported canonical tracer language: ${String(canonicalLanguage)}`)
  }
  if (typeof version !== 'string' || !IMAGE_TAG_REG_EXP.test(version)) {
    throw new Error(`Invalid tracer version: ${JSON.stringify(version)}`)
  }

  return `${registry}/dd-lib-${canonicalLanguage}-init:${version}`
}
