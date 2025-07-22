import {Command} from 'clipanion'

export interface DatadogCiConfig {
  apiKey: string | undefined
  env: string | undefined
  envVarTags: string | undefined
}

export type ExtractCommandConfig<T extends Command> = Partial<
  Omit<
    {
      [K in keyof T as T[K] extends string | boolean | string[] | undefined ? K : never]: T[K]
    },
    'help' | 'path' | 'paths'
  >
>
