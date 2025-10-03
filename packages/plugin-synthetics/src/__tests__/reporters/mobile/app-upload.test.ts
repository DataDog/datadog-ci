jest.unmock('chalk')

// Force `process.platform` to have the same spinner snapshots on all platforms.
// Without this, `ora` falls back to use a `-` on Windows, resulting in snapshot diffs (`-` instead of `⠋`).
// See https://github.com/sindresorhus/ora#spinner
Object.defineProperty(process, 'platform', {
  value: 'linux',
  configurable: true,
  writable: true,
})

import {CommandContext} from '@datadog/datadog-ci-base'

import {AppUploadReporter} from '../../../reporters/mobile/app-upload'

/* eslint-disable jest/no-conditional-expect */
describe('AppUploadReporter', () => {
  let initialCiEnv: string | undefined
  let simulatedTerminalOutput: string
  let writeMock: jest.Mock
  let clearLine: jest.Mock
  let ttyReporter: AppUploadReporter

  beforeEach(() => {
    jest.useFakeTimers()
    initialCiEnv = process.env.CI

    simulatedTerminalOutput = ''

    writeMock = jest.fn().mockImplementation((text: string) => {
      // Ignore show/hide cursor ANSI codes.
      if (text.match(/\u001b\[\?25(l|h)/)) {
        return
      }

      simulatedTerminalOutput += text
    })

    clearLine = jest.fn().mockImplementation(() => {
      const allLinesMinusLast = simulatedTerminalOutput.split('\n').slice(0, -1)
      allLinesMinusLast.push('')
      simulatedTerminalOutput = allLinesMinusLast.join('\n')
    })

    const ttyContext: unknown = {
      stdout: {
        isTTY: true,
        write: writeMock,
        clearLine,
        cursorTo: jest.fn(),
        moveCursor: jest.fn(),
      },
      stderr: {
        write: writeMock,
      },
    }

    ttyReporter = new AppUploadReporter(ttyContext as CommandContext)
  })

  afterEach(() => {
    jest.useRealTimers()
    if (initialCiEnv !== undefined) {
      process.env.CI = initialCiEnv
    } else {
      delete process.env.CI
    }
  })

  describe('start', () => {
    test('outputs apps to upload', async () => {
      const appsToUpload = [
        {
          versionName: '1.0.0',
          appId: '123',
          appPath: '/path/to/app',
        },
        {
          versionName: '2.0.0',
          appId: '456',
          appPath: '/path/to/another/app',
        },
      ]
      ttyReporter.start(appsToUpload)
      const output = writeMock.mock.calls.map((c) => c[0]).join('\n')
      expect(output).toMatchSnapshot()

      writeMock.mockClear()
      ttyReporter.start(appsToUpload, true)
      const output2 = writeMock.mock.calls.map((c) => c[0]).join('\n')
      expect(output2).toMatchSnapshot()
    })
  })

  describe('renderProgress', () => {
    test.each([false, true])('Outputs progress (in CI: %s)', async (inCI) => {
      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }

      ttyReporter.renderProgress(2)
      expect(clearLine).not.toHaveBeenCalled()
      expect(simulatedTerminalOutput).toMatchSnapshot()

      ttyReporter.renderProgress(1)
      if (inCI) {
        // In CI, there is no spinning, so `stopping` the spinner (which happens when rendering a 2nd time) does not clear a line.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
      expect(simulatedTerminalOutput).toMatchSnapshot()
    })
  })

  describe('reportSuccess', () => {
    test.each([false, true])('Outputs success message (in CI: %s)', async (inCI) => {
      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }
      ttyReporter.renderProgress(1)
      ttyReporter.reportSuccess()
      expect(simulatedTerminalOutput).toMatchSnapshot()
      if (inCI) {
        // In CI, there is no spinning, so `stopping` the spinner (which happens when rendering a 2nd time) does not clear a line.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
    })
  })

  describe('reportFailure', () => {
    test.each([false, true])('Outputs failure message (in CI: %s)', async (inCI) => {
      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }
      ttyReporter.renderProgress(1)
      ttyReporter.reportFailure({
        versionName: '1.0.0',
        appId: '123',
        appPath: '/path/to/app',
      })
      expect(simulatedTerminalOutput).toMatchSnapshot()
      if (inCI) {
        // In CI, there is no spinning, so `stopping` the spinner (which happens when rendering a 2nd time) does not clear a line.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
    })
  })

  describe('endRendering', () => {
    test.each([false, true])('Ends rendering (in CI: %s)', async (inCI) => {
      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }
      ttyReporter.renderProgress(1)
      expect(ttyReporter['spinner']).toBeDefined()
      ttyReporter.endRendering()
      expect(ttyReporter['spinner']).toBeUndefined()
      expect(simulatedTerminalOutput).toMatchSnapshot()
      if (inCI) {
        // In CI, there is no spinning, so `stopping` the spinner (which happens when rendering a 2nd time) does not clear a line.
        expect(clearLine).not.toHaveBeenCalled()
      } else {
        expect(clearLine).toHaveBeenCalled()
      }
    })
  })

  describe('integrationTests', () => {
    test.each([false, true])('Outputs a series of successful uploads correctly (in CI: %s)', async (inCI) => {
      if (inCI) {
        process.env.CI = 'true'
      } else {
        delete process.env.CI
      }
      ttyReporter.start([
        {
          versionName: '1.0.0',
          appId: '123',
          appPath: '/path/to/app',
        },
        {
          versionName: '2.0.0',
          appId: '456',
          appPath: '/path/to/another/app',
        },
      ])
      expect(simulatedTerminalOutput).toMatchSnapshot()

      ttyReporter.renderProgress(2)
      expect(simulatedTerminalOutput).toMatchSnapshot()

      ttyReporter.renderProgress(1)
      expect(simulatedTerminalOutput).toMatchSnapshot()

      ttyReporter.reportSuccess()
      expect(simulatedTerminalOutput).toMatchSnapshot()
    })
  })

  test.each([false, true])('Outputs a failure during uploads correctly (in CI: %s)', async (inCI) => {
    if (inCI) {
      process.env.CI = 'true'
    } else {
      delete process.env.CI
    }
    ttyReporter.start([
      {
        versionName: '1.0.0',
        appId: '123',
        appPath: '/path/to/app',
      },
      {
        versionName: '2.0.0',
        appId: '456',
        appPath: '/path/to/another/app',
      },
    ])
    expect(simulatedTerminalOutput).toMatchSnapshot()

    ttyReporter.renderProgress(2)
    expect(simulatedTerminalOutput).toMatchSnapshot()

    ttyReporter.renderProgress(1)
    expect(simulatedTerminalOutput).toMatchSnapshot()

    ttyReporter.reportFailure({
      versionName: '2.0.0',
      appId: '456',
      appPath: '/path/to/another/app',
    })
    expect(simulatedTerminalOutput).toMatchSnapshot()
  })
})
