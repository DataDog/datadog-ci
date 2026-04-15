export const SSI_LANGUAGES = ['python', 'nodejs', 'java'] as const
export type SSILanguage = (typeof SSI_LANGUAGES)[number]

export interface SSILanguageConfig {
  envVar: string
  envValue: string
  initImage: string
}

export const SSI_LANGUAGE_CONFIGS: Record<SSILanguage, SSILanguageConfig> = {
  python: {
    envVar: 'PYTHONPATH',
    envValue: '/dd-tracer',
    initImage: 'gcr.io/datadoghq/dd-lib-python-init:latest',
  },
  nodejs: {
    envVar: 'NODE_OPTIONS',
    envValue: '--require /dd-tracer/node_modules/dd-trace/init.js',
    initImage: 'gcr.io/datadoghq/dd-lib-js-init:latest',
  },
  java: {
    envVar: 'JAVA_TOOL_OPTIONS',
    envValue: '-javaagent:/dd-tracer/dd-java-agent.jar',
    initImage: 'gcr.io/datadoghq/dd-lib-java-init:latest',
  },
}

export const TRACER_INIT_CONTAINER_NAME = 'tracer-init'
export const TRACER_VOLUME_NAME = 'dd-tracer'
export const TRACER_VOLUME_PATH = '/dd-tracer'
export const TRACER_INIT_HEALTH_PORT = 18999

export const SSI_ENV_VAR_NAMES = Object.values(SSI_LANGUAGE_CONFIGS).map((c) => c.envVar)
