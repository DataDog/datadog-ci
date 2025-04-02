import {ChildProcess, spawn} from 'child_process'
import {once} from 'events'

import axios from 'axios'

import {MainReporter} from './interfaces'
import {poll} from './utils/internal'

interface BuildStatus {
  status: 'running' | 'fail' | 'success'
  publicPrefix?: string
}

type BuildCommandReturnValue =
  | {
      readiness: 'buildCommandReady'
      publicPrefix?: string
    }
  | {
      readiness: 'buildCommandExited'
    }
  | {
      readiness: 'buildCommandErrored'
      error: Error
    }

export const DEFAULT_BUILD_PLUGIN_PORT = 4000

export const UnconfiguredBuildPluginError = new Error(`
We couldn't detect the Datadog Build plugins within your build. Did you add it?
If not, you can learn more about it here: https://github.com/DataDog/build-plugins#readme
`)

const watchBuildPluginServerReadiness = async (buildPluginServerUrl: string, abortSignal: AbortSignal) => {
  return poll(async () => {
    try {
      const response = await axios.get<BuildStatus>(buildPluginServerUrl, {signal: abortSignal})
      const {status, publicPrefix = ''} = response.data

      if (status === 'success') {
        return {
          readiness: 'buildCommandReady',
          publicPrefix,
        } as const
      }
    } catch (error) {
      // If we got an http error with a response, return buildCommandErrored
      if (axios.isAxiosError(error)) {
        if (error.code !== 'ECONNREFUSED' && error.response) {
          return {
            readiness: 'buildCommandErrored',
            error: new Error(`Dev server returned error: ${error.response.status} ${error.response.statusText}`),
          } as const
        }
      }
      // Otherwise ignore errors and continue polling in case the dev server is still starting
    }
  }, abortSignal)
}

const watchBuildCommandExit = async (buildCommand: ChildProcess) => {
  await once(buildCommand, 'close')

  return {
    readiness: 'buildCommandExited',
  } as const
}

export const spawnBuildPluginDevServer = async (
  buildCommand: string,
  reporter: MainReporter
): Promise<{
  devServerUrl: string
  publicPrefix: string
  stop: () => Promise<void>
}> => {
  const buildPluginPort = DEFAULT_BUILD_PLUGIN_PORT

  // Spawn the build command process with the BUILD_PLUGINS_S8S_PORT environment variable.
  const buildCommandProcess = spawn(buildCommand, [], {
    env: {BUILD_PLUGINS_S8S_PORT: String(buildPluginPort)},
    shell: true,
  })

  // Wait for the build command to either exit, or provide a dev server serving the built assets.
  const controller = new AbortController() // used to abort the watcher and its http requests
  const buildCommandExited = watchBuildCommandExit(buildCommandProcess)
  const buildCommandReady = watchBuildPluginServerReadiness(
    'http://localhost:' + String(buildPluginPort) + '/_datadog-ci_/build-status',
    controller.signal
  )
  const buildCommandReturnValue: BuildCommandReturnValue | undefined = await Promise.race([
    buildCommandReady,
    buildCommandExited,
  ])
  controller.abort()

  if (buildCommandReturnValue === undefined) {
    throw new Error('Unexpected state: buildCommandReturnValue is undefined')
  }

  if (buildCommandReturnValue.readiness === 'buildCommandExited') {
    reporter.error(UnconfiguredBuildPluginError.message)
    throw UnconfiguredBuildPluginError
  }

  if (buildCommandReturnValue.readiness === 'buildCommandErrored') {
    reporter.error(buildCommandReturnValue.error.message)
    killBuildCommand(buildCommandProcess)
    throw buildCommandReturnValue.error
  }

  const {publicPrefix = ''} = buildCommandReturnValue

  // Once the build server is ready, return its URL with the advertised public prefix to run the tests against it.
  return {
    devServerUrl: 'http://localhost:' + String(buildPluginPort),
    publicPrefix,
    stop: async () => {
      killBuildCommand(buildCommandProcess)
      await buildCommandExited
    },
  }
}

const killBuildCommand = (buildCommandProcess: ChildProcess) => {
  buildCommandProcess.kill()
  buildCommandProcess.stdin?.destroy()
  buildCommandProcess.stdout?.destroy()
  buildCommandProcess.stderr?.destroy()
}
