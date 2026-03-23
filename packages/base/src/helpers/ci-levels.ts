import {CI_ENGINES, getCIProvider} from './ci'

export const VALID_LEVELS = ['pipeline', 'job', 'stage', 'step'] as const
export type CILevel = (typeof VALID_LEVELS)[number]

export const LEVEL_TO_NUMBER: Record<CILevel, number> = {pipeline: 0, job: 1, stage: 2, step: 3}

/**
 * Validates that the level is a known value and is supported for the current CI provider.
 * Returns an error message string if invalid, or undefined if valid.
 */
export const validateLevel = (level: string | undefined): string | undefined => {
  if (!level || !(VALID_LEVELS as readonly string[]).includes(level)) {
    return `Level must be one of [${VALID_LEVELS.join(', ')}]`
  }

  const provider = getCIProvider()
  const stageProviders = [CI_ENGINES.AZURE, CI_ENGINES.GITLAB, CI_ENGINES.JENKINS]

  if (level === 'stage' && !stageProviders.includes(provider)) {
    return `Level 'stage' is only supported for providers [${stageProviders.join(', ')}]`
  }

  if (level === 'stage' && provider === CI_ENGINES.JENKINS && !process.env.DD_CUSTOM_STAGE_ID) {
    return `Level 'stage' for Jenkins requires the Datadog plugin version to be >= 9.2`
  }

  if (level === 'step' && provider !== CI_ENGINES.GITHUB) {
    return `Level 'step' is only supported for provider [${CI_ENGINES.GITHUB}]`
  }

  return undefined
}
