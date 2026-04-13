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

type InquirerPromptStatus = 'idle' | 'loading' | 'done'

type KeypressEvent = {
  ctrl: boolean
  name: string
  shift: boolean
}

type Readline = {
  clearLine: (dir: number) => void
  line: string
  write: (input: string) => void
}

type InquirerTheme = {
  style: {
    answer: (text: string) => string
    error: (text: string) => string
    highlight: (text: string) => string
    message: (text: string, status: InquirerPromptStatus) => string
  }
}

type PaginationConfig<Item> = {
  active: number
  items: readonly Item[]
  loop?: boolean
  pageSize: number
  renderItem: (options: {index: number; isActive: boolean; item: Item}) => string
}

type PromptView<Value, Config> = (config: Config, done: (value: Value) => void) => string | [string, string | undefined]

type InquirerCore = {
  createPrompt: <Value, Config>(view: PromptView<Value, Config>) => (config: Config) => Promise<Value>
  isDownKey: (key: KeypressEvent) => boolean
  isEnterKey: (key: KeypressEvent) => boolean
  isSpaceKey: (key: KeypressEvent) => boolean
  isUpKey: (key: KeypressEvent) => boolean
  makeTheme: <Theme>(defaultTheme: Theme, customTheme?: unknown) => Theme & InquirerTheme
  useEffect: (effect: (readline: Readline) => void | (() => void), dependencies?: readonly unknown[]) => void
  useKeypress: (handler: (key: KeypressEvent, readline: Readline) => void | Promise<void>) => void
  useMemo: <Value>(value: () => Value, dependencies: readonly unknown[]) => Value
  usePagination: <Item>(config: PaginationConfig<Item>) => string
  usePrefix: (options: {status: InquirerPromptStatus; theme?: unknown}) => string
  useState: <Value>(value: Value) => [Value, (value: Value) => void]
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval -- TypeScript rewrites plain `import()` to `require()` in our CommonJS emit.
const importInquirerModule = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>

// Preserve a real runtime dynamic import so Node can load the ESM-only prompt package from CommonJS output.
export const loadPrompts = () => importInquirerModule('@inquirer/prompts') as Promise<InquirerPrompts>

export const loadCore = () => importInquirerModule('@inquirer/core') as Promise<InquirerCore>
