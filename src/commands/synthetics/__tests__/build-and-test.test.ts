import {once} from 'events'
import * as http from 'http'

import {spawnBuildPluginDevServer} from '../build-and-test'

import {mockReporter} from './fixtures'

// if BUILD_PLUGINS_S8S_PORT is defined, this command does nothing forever, otherwise, it exits immediately
const MOCKED_BUILD_COMMAND = (port: number) => `[ "$BUILD_PLUGINS_S8S_PORT" = "${port}" ] && tail -f /dev/null`
// this command simulates a build command without the build plugin configured
const MOCKED_BUILD_COMMAND_NOT_CONFIGURED = 'echo "build successful"'

describe('build-and-test - spawnBuildPluginDevServer', () => {
  test('wait for the dev server and return expected readiness and status', async () => {
    // Given a dev server which listen on port 4000
    const port = 4000
    const requests: string[] = []
    const server = http
      .createServer((req, res) => {
        requests.push(String(req.url))
        res.writeHead(200, {'Content-Type': 'application/json'})
        res.end(
          JSON.stringify({
            status: 'success',
            publicPrefix: 'prefix/',
          })
        )
      })
      .listen(port)

    // When calling spawnBuildPluginDevServer
    const command = await spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND(port), port, mockReporter)

    // Then it should send requests to the dev server until it's ready to serve,
    // and return the devServerUrl and the path prefix.
    expect(command.devServerUrl).toBe('http://localhost:4000')
    expect(command.publicPrefix).toBe('prefix/')
    expect(requests.pop()).toBe('/_datadog-ci_/build-status')

    // Close the server and the command at the end of the test.
    server.close()
    await Promise.all([command.stop(), once(server, 'close')])
  })

  test('alert when the build-plugin is not configured', async () => {
    // Given a build command without the build plugin configured
    // When calling spawnBuildPluginDevServer
    const commandPromise = spawnBuildPluginDevServer(MOCKED_BUILD_COMMAND_NOT_CONFIGURED, 4000, mockReporter)

    // Then it should throw when the command exits.
    await expect(commandPromise).rejects.toThrow(
      'Build command exited before the build plugin could be started. Is the build plugin configured?'
    )
  })
})
