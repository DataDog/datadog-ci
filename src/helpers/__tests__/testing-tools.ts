import {Writable} from 'stream'

import {AxiosError, AxiosResponse, InternalAxiosRequestConfig} from 'axios'
import {BaseContext, Cli, Command, CommandClass} from 'clipanion'
import {CommandOption} from 'clipanion/lib/advanced/options'
import upath from 'upath'

import {CommandContext} from '../interfaces'

export const MOCK_BASE_URL = 'https://app.datadoghq.com/'
export const MOCK_DATADOG_API_KEY = '02aeb762fff59ac0d5ad1536cd9633bd'
export const MOCK_CWD = 'mock-folder'
export const MOCK_FLARE_FOLDER_PATH = upath.join(MOCK_CWD, '.datadog-ci')

interface MockContextOptions {
  /**
   * Whether to append `stderr` to `stdout` for testing purposes, to make it easier to check against snapshots.
   *
   * This way, `context.stdout.toString()` looks like what a user would see in their terminal if they didn't redirect the standard output or error.
   */
  appendStdoutWithStderr?: boolean
  /**
   * Define a custom environment for the command. That's only useful if your command uses `this.env` instead of `process.env`.
   */
  env?: CommandContext['env']
}

interface MakeRunCLIOptions extends MockContextOptions {
  /**
   * Enable this if you want to set `process.env` yourself in the test before running `runCLI`.
   */
  skipResetEnv?: boolean
}

export const createMockContext = (opts?: MockContextOptions): CommandContext => {
  let out = ''
  let err = ''

  const stdout = new Writable({
    write: (chunk: string, _, cb: () => void) => {
      out += chunk
      cb()
    },
  })
  stdout.toString = () => out

  const stderr = new Writable({
    write: (chunk: string, _, cb: () => void) => {
      err += chunk
      if (opts?.appendStdoutWithStderr) {
        out += chunk
      }
      cb()
    },
  })
  stderr.toString = () => err

  return {
    env: opts?.env ?? {},
    stdout,
    stderr,
  }
}

export const getEnvVarPlaceholders = () => ({
  DD_API_KEY: 'PLACEHOLDER',
  DD_APP_KEY: 'PLACEHOLDER',
  DATADOG_API_KEY: 'PLACEHOLDER',
  DATADOG_APP_KEY: 'PLACEHOLDER',
})

export const makeRunCLI = (commandClass: CommandClass, baseArgs: string[], opts?: MakeRunCLIOptions) => async (
  extraArgs: string[],
  extraEnv?: Record<string, string>
) => {
  const cli = new Cli()
  cli.register(commandClass)

  if (!opts?.skipResetEnv) {
    process.env = getEnvVarPlaceholders()
  }

  process.env = {
    ...process.env,
    ...opts?.env,
    ...extraEnv,
  }

  const context = createMockContext({...opts, env: process.env})
  const code = await cli.run([...baseArgs, ...extraArgs], context)

  return {context, code}
}

const isCommandOption = <T = unknown>(value: unknown): value is CommandOption<T> => {
  // eslint-disable-next-line no-null/no-null
  return typeof value === `object` && value !== null && Command.isOption in value && !!value[Command.isOption]
}

/**
 * When constructing an instance of a command, all the options contain a `CommandOption` object returned by `Option.*`.
 * This function runs their transformer to get their default value (`undefined` or `initialValue`).
 * @param command An instance of a command.
 */
export const resolveCommandOptionsDefaults = (command: Command) => {
  for (const [key, value] of Object.entries(command)) {
    if (isCommandOption(value)) {
      ;(command as any)[key] = value.transformer(
        undefined as any,
        undefined as any,
        {options: [], positionals: []} as any,
        process as any
      )
    }
  }
}

/**
 * Allow for constructors with any amount of parameters.
 * Mainly used for testing when we are creating commands.
 */
export type ConstructorOf<T> = new (...args: unknown[]) => T

/**
 * Allows to create an instance of any command that
 * extends the Command class.
 *
 * @param commandClass any class that extends the Command class.
 * @param context command context
 * @returns the instance of the given command with a mock context attached.
 */
export const createCommand = <T extends Command>(
  commandClass: ConstructorOf<T>,
  context: {stdout?: {write: () => void}; stderr?: {write: () => void}} = {}
) => {
  // Create a new instance of commandClass and pass in the parameters
  const command = new commandClass()
  command.context = {...createMockContext(), ...context} as BaseContext

  resolveCommandOptionsDefaults(command)

  return command
}

export const getAxiosError = (status: number, {errors, message}: {errors?: string[]; message?: string}) => {
  const serverError = new AxiosError(message) as AxiosError<any> & {config: InternalAxiosRequestConfig}
  serverError.config = {baseURL: MOCK_BASE_URL, url: 'example'} as InternalAxiosRequestConfig
  serverError.response = {data: {errors}, status} as AxiosResponse

  return serverError
}
