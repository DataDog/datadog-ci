type PromptValidation<Value> = (value: Value) => boolean | string | Promise<boolean | string>

type Choice<Value> =
  | Value
  | {
      checked?: boolean
      description?: string
      disabled?: boolean | string
      name: string
      short?: string
      value: Value
    }

export type CheckboxConfig<Value = string> = {
  choices: readonly Choice<Value>[]
  default?: readonly Value[]
  message: string
  pageSize?: number
  validate?: PromptValidation<readonly Value[]>
}

export type ConfirmConfig = {
  default?: boolean
  message: string
}

export type InputConfig = {
  default?: string
  message: string
  validate?: PromptValidation<string>
}

export type PasswordConfig = {
  default?: string
  mask?: boolean | string
  message: string
  validate?: PromptValidation<string>
}

export type SelectConfig<Value = string> = {
  choices: readonly Choice<Value>[]
  default?: Value
  message: string
}

export type InquirerPrompts = {
  checkbox: <Value = string>(config: CheckboxConfig<Value>) => Promise<Value[]>
  confirm: (config: ConfirmConfig) => Promise<boolean>
  input: (config: InputConfig) => Promise<string>
  password: (config: PasswordConfig) => Promise<string>
  select: <Value = string>(config: SelectConfig<Value>) => Promise<Value>
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval -- TypeScript rewrites plain `import()` to `require()` in our CommonJS emit.
const importInquirerPrompts = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<InquirerPrompts>

// Preserve a real runtime dynamic import so Node can load the ESM-only prompt package from CommonJS output.
export const loadPrompts = () => importInquirerPrompts('@inquirer/prompts')
