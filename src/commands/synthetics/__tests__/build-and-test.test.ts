import {buildAssets, MalformedBuildError, UnconfiguredBuildPluginError} from '../build-and-test'

import {mockReporter} from './fixtures'

const NODE_COMMAND = process.execPath

describe('build-and-test - buildAssets', () => {
  const tearDowns: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (let tearDown; (tearDown = tearDowns.pop()); ) {
      await tearDown()
    }
  })

  // This httpClient function should be self-contained, as its body will be injected as a string in the build command.
  const httpClient = () => {
    const url = process.env.DATADOG_SYNTHETICS_REPORT_BUILD_URL
    if (!url) {
      throw new Error('DATADOG_SYNTHETICS_REPORT_BUILD_URL is not set')
    }
    void fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        outputDirectory: 'output-directory',
        publicPath: 'prefix/',
      }),
    })
  }

  test('alert when the build-plugin is not configured', async () => {
    // Given a build command without the build plugin configured
    const MOCKED_BUILD_COMMAND_NOT_CONFIGURED = `${NODE_COMMAND} -e "console.log('build successful')"`

    // When calling spawnBuildPluginDevServer
    const commandPromise = buildAssets(MOCKED_BUILD_COMMAND_NOT_CONFIGURED, mockReporter)

    // Then it should throw when the command exits.
    await expect(commandPromise).rejects.toThrow(UnconfiguredBuildPluginError)
  })

  test('advertise the right URL and returns the reported builds', async () => {
    // Given a build command which reports a build with a publicPath and an outputDirectory to the url advertised by DATADOG_SYNTHETICS_REPORT_BUILD_URL
    const CLIENT_IMPLEMENTATION = httpClient.toString().replace(/\n\s+/g, '')
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "(${CLIENT_IMPLEMENTATION})()"`

    // When calling spawnBuildPluginDevServer
    const {builds, devServerUrl, stop} = await buildAssets(MOCKED_BUILD_COMMAND, mockReporter)
    tearDowns.push(stop)

    // Then it should return the devServerUrl and the path prefix.
    expect(devServerUrl).toMatch(/\/_datadog-ci_\/build$/)
    expect(builds).toEqual([
      {
        outputDirectory: 'output-directory',
        publicPath: 'prefix/',
      },
    ])
  })

  test('rejects malformed builds', async () => {
    // Given the devServer to which to report builds
    const CLIENT_IMPLEMENTATION = httpClient.toString().replace(/\n\s+/g, '')
    const MOCKED_BUILD_COMMAND = `${NODE_COMMAND} -e "(${CLIENT_IMPLEMENTATION})()"`

    const {devServerUrl, stop} = await buildAssets(MOCKED_BUILD_COMMAND, mockReporter)
    tearDowns.push(stop)

    // When sending a malformed build
    const correctPayload = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        outputDirectory: 'output-directory',
        publicPath: 'prefix/',
      },
    }
    const [missingOutputDirectory, missingPublicPath] = await Promise.all([
      fetch(devServerUrl, {
        ...correctPayload,
        body: JSON.stringify({...correctPayload.body, outputDirectory: undefined}),
      }),
      fetch(devServerUrl, {
        ...correctPayload,
        body: JSON.stringify({...correctPayload.body, publicPath: undefined}),
      }),
    ])

    // Then it should reject the malformed builds reported.
    expect(missingOutputDirectory.status).toBe(500)
    expect(await missingOutputDirectory.text()).toBe(`Internal Server Error: ${MalformedBuildError.message}`)

    expect(missingPublicPath.status).toBe(500)
    expect(await missingPublicPath.text()).toBe(`Internal Server Error: ${MalformedBuildError.message}`)
  })
})
