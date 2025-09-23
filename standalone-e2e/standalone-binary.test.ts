import child_process from 'node:child_process'

import {version} from '../packages/datadog-ci/package.json'

const execPromise = async (command: string): Promise<{exitCode: number; stdout: string; stderr: string}> => {
  return new Promise((resolve) => {
    child_process.exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve({
          exitCode: error.code || 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      } else {
        resolve({
          exitCode: 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      }
    })
  })
}

const isWin = process.platform === 'win32'
const os = isWin ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'

const isARM = process.arch === 'arm64'
const arch = isARM ? 'arm64' : 'x64'

const STANDALONE_BINARY = `./datadog-ci_${os}-${arch}${isWin ? '.exe' : ''}`

const timeoutPerPlatform: Record<typeof os, number> = {
  // Some macOS agents sometimes run slower, making this test suite flaky on macOS only.
  // The issue is tracked here: https://github.com/actions/runner-images/issues/3885
  darwin: 10 * 1000,
  // Keep the default timeout for Linux.
  linux: 5 * 1000,
  // Running the binary on Windows is also slower than on Linux, and sometimes times out by a very small margin.
  win: 10 * 1000,
}

describe('standalone binary', () => {
  jest.setTimeout(timeoutPerPlatform[os])

  describe('version', () => {
    it('can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} version`)
      // .slice(1) to remove the "v"
      expect(result.stdout.slice(1)).toStrictEqual(version)
    })
  })
  describe('dsyms', () => {
    it('upload can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} dsyms upload --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci dsyms upload') as string,
        stderr: '',
      })
    })
  })
  describe('git-metadata', () => {
    it('upload can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} git-metadata upload --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci git-metadata upload') as string,
        stderr: '',
      })
    })
  })
  describe('junit', () => {
    it('upload can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} junit upload --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci junit upload') as string,
        stderr: '',
      })
    })
  })
  describe('lambda', () => {
    it('instrument can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} lambda instrument --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci lambda instrument') as string,
        stderr: '',
      })
    })
  })
  describe('sourcemaps', () => {
    it('upload can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} sourcemaps upload --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci sourcemaps upload') as string,
        stderr: '',
      })
    })
  })
  describe('stepfunctions', () => {
    it('instrument can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} stepfunctions instrument --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci stepfunctions instrument') as string,
        stderr: '',
      })
    })

    it('uninstrument can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} stepfunctions uninstrument --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci stepfunctions uninstrument') as string,
        stderr: '',
      })
    })
  })
  describe('synthetics', () => {
    it('run-tests can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} synthetics run-tests --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci synthetics run-tests') as string,
        stderr: '',
      })
    })

    it('plugin can be loaded', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} plugin check synthetics run-tests`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('The plugin is ready to be used! 🔌') as string,
        stderr: '',
      })
    })
  })
  describe('trace', () => {
    it('can be called', async () => {
      const result = await execPromise(`${STANDALONE_BINARY} trace --help`)
      expect(result).toStrictEqual({
        exitCode: 0,
        stdout: expect.stringContaining('datadog-ci trace') as string,
        stderr: '',
      })
    })
  })
})
