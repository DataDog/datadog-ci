import * as http from 'http'

import axios from 'axios'

import {UnconfiguredBuildPluginError, spawnBuildPluginDevServer} from '../build-and-test'

import {mockReporter} from './fixtures'

const NODE_COMMAND = process.execPath

describe('build-and-test - spawnBuildPluginDevServer', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.restoreAllMocks()
  })

  test('alert when the build-plugin is not configured', async () => {
    // Given a build command without the build plugin configured
    const MOCKED_BUILD_COMMAND_NOT_CONFIGURED = `${NODE_COMMAND} -e "console.log('build successful')"`

    // When calling spawnBuildPluginDevServer
    const commandPromise = spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND_NOT_CONFIGURED, mockReporter)

    // Then it should throw when the command exits.
    await expect(commandPromise).rejects.toThrow(UnconfiguredBuildPluginError)
  })

  test('wait for the dev server and return expected readiness and status even with delayed server startup', async () => {
    // Given a dev server which listen on the port provided in the environment variable BUILD_PLUGINS_S8S_PORT.
    // The implementation of this server is written as a function, and stringified into a single line,
    // to be used in a node -e command.
    const httpDevServer = () => {
      setTimeout(() => {
        http
          .createServer((_, res) =>
            res
              .writeHead(200, {
                'Content-Type': 'application/json',
              })
              .end(
                JSON.stringify({
                  status: 'success',
                  publicPrefix: 'prefix2/',
                })
              )
          )
          .listen(process.env.BUILD_PLUGINS_S8S_PORT)
      }, 500)
    }
    const SERVER_IMPLEMENTATION = httpDevServer.toString().replace(/\n\s+/g, '')
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "(${SERVER_IMPLEMENTATION})()"`

    // When calling spawnBuildPluginDevServer
    const start = Date.now()
    const command = await spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND, mockReporter)
    const end = Date.now()

    // Then it should send requests to the dev server until it's ready to serve,
    // and return the devServerUrl and the path prefix.
    expect(command.devServerUrl).toBe('http://localhost:4000')
    expect(command.publicPrefix).toBe('prefix2/')

    // The server should resolve the promise at maximum 1 second after the server is ready
    expect(end - start).toBeLessThanOrEqual(500 + 1000)

    // Stop the command at the end of the test.
    await command.stop()
  })

  test('should wait for dev server even if the build fails', async () => {
    // Set up axios response sequence
    jest
      .spyOn(axios, 'get')
      .mockRejectedValueOnce({code: 'ECONNREFUSED'}) // First attempt: connection refused
      .mockResolvedValueOnce({data: {status: 'fail'}}) // Second attempt: build failed
      .mockResolvedValueOnce({data: {status: 'success', publicPrefix: 'prefix3/'}}) // Third attempt: success

    // Setup isAxiosError for ECONNREFUSED error
    jest.spyOn(axios, 'isAxiosError').mockImplementation((error) => {
      return error && error.code === 'ECONNREFUSED'
    })

    // When calling spawnBuildPluginDevServer with any command
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "setTimeout(() => {}, 100000)"`
    const command = await spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND, mockReporter)

    // Then it should wait until the build succeeds
    expect(command.devServerUrl).toBe('http://localhost:4000')
    expect(command.publicPrefix).toBe('prefix3/')

    // Verify the axios GET was called multiple times
    expect(axios.get).toHaveBeenCalledTimes(3)

    // Stop the command at the end of the test.
    await command.stop()
  })

  test('should handle non-OK status code from dev server', async () => {
    // Set up axios error response
    const axiosError = {
      isAxiosError: true,
      code: 'ERR_BAD_RESPONSE',
      response: {
        status: 500,
        statusText: 'Internal Server Error',
      },
    }

    jest.spyOn(axios, 'get').mockRejectedValueOnce(axiosError)

    // Setup isAxiosError for the specific error
    jest.spyOn(axios, 'isAxiosError').mockImplementation((error) => {
      return error === axiosError
    })

    // When calling spawnBuildPluginDevServer with any command
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "setTimeout(() => {}, 100000)"`
    const commandPromise = spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND, mockReporter)

    // Then it should throw with the server error
    await expect(commandPromise).rejects.toThrow('Dev server returned error: 500 Internal Server Error')
  })
})
