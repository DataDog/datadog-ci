import * as http from 'http'

import {UnconfiguredBuildPluginError, spawnBuildPluginDevServer} from '../build-and-test'

import {mockReporter} from './fixtures'

const NODE_COMMAND = process.execPath

describe('build-and-test - spawnBuildPluginDevServer', () => {
  test('alert when the build-plugin is not configured', async () => {
    // Given a build command without the build plugin configured
    const MOCKED_BUILD_COMMAND_NOT_CONFIGURED = `${NODE_COMMAND} -e "console.log('build successful')"`

    // When calling spawnBuildPluginDevServer
    const commandPromise = spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND_NOT_CONFIGURED, mockReporter)

    // Then it should throw when the command exits.
    await expect(commandPromise).rejects.toThrow(UnconfiguredBuildPluginError)
  })

  test('wait for the dev server and return expected readiness and status', async () => {
    // Given a dev server which listen on the port provided in the environment variable BUILD_PLUGINS_S8S_PORT.
    // The implementation of this server is written as a function, and stringified into a single line,
    // to be used in a node -e command.
    const httpDevServer = () => {
      http
        .createServer((_, res) =>
          res
            .writeHead(200, {'Content-Type': 'application/json'})
            .end(JSON.stringify({status: 'success', publicPrefix: 'prefix/'}))
        )
        .listen(process.env.BUILD_PLUGINS_S8S_PORT)
    }
    const SERVER_IMPLEMENTATION = httpDevServer.toString().replace(/\n\s+/g, '')
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "(${SERVER_IMPLEMENTATION})()"`

    // When calling spawnBuildPluginDevServer
    const command = await spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND, mockReporter)

    // Then it should send requests to the dev server until it's ready to serve,
    // and return the devServerUrl and the path prefix.
    expect(command.devServerUrl).toBe('http://localhost:4000')
    expect(command.publicPrefix).toBe('prefix/')

    // Stop the command at the end of the test.
    await command.stop()
  })
})
