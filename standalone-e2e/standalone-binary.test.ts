import {exec} from 'child_process'
import {promisify} from 'util'

import {version} from '../package.json'

const execPromise = promisify(exec)

const isWin = process.platform === 'win32'
const os = isWin ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'

const isARM = process.arch === 'arm64'
const arch = isARM && os === 'linux' ? 'arm64' : 'x64'

const STANDALONE_BINARY = `datadog-ci_${os}-${arch}`
const STANDALONE_BINARY_PATH = `${isWin ? '.\\' : './'}${STANDALONE_BINARY}${isWin ? '.exe' : ''}`

const sanitizeOutput = (output: string) => output.replace(/(\r\n|\n|\r)/gm, '')

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
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} version`)
      const binaryVersion = sanitizeOutput(stdout)
      // .slice(1) to remove the "v"
      expect(binaryVersion.slice(1)).toEqual(version)
    })
  })
  describe('dsyms', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} dsyms upload --help`)
      const dsymsHelpText = sanitizeOutput(stdout)
      expect(dsymsHelpText).toContain('datadog-ci dsyms upload')
    })
  })
  describe('git-metadata', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} git-metadata upload --help`)
      const gitMetadataHelpText = sanitizeOutput(stdout)
      expect(gitMetadataHelpText).toContain('datadog-ci git-metadata upload')
    })
  })
  describe('junit', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} junit upload --help`)
      const junitHelpText = sanitizeOutput(stdout)
      expect(junitHelpText).toContain('datadog-ci junit upload')
    })
  })
  describe('lambda', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} lambda instrument --help`)
      const lambdaHelpText = sanitizeOutput(stdout)
      expect(lambdaHelpText).toContain('datadog-ci lambda instrument')
    })
  })
  describe('sourcemaps', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} sourcemaps upload --help`)
      const sourceMapsHelpText = sanitizeOutput(stdout)
      expect(sourceMapsHelpText).toContain('datadog-ci sourcemaps upload')
    })
  })
  describe('stepfunctions', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} stepfunctions instrument --help`)
      const stepFunctionsHelpText = sanitizeOutput(stdout)
      expect(stepFunctionsHelpText).toContain('datadog-ci stepfunctions instrument')
    })
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} stepfunctions uninstrument --help`)
      const stepFunctionsHelpText = sanitizeOutput(stdout)
      expect(stepFunctionsHelpText).toContain('datadog-ci stepfunctions uninstrument')
    })
  })
  describe('synthetics', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} synthetics run-tests --help`)
      const syntheticsHelpText = sanitizeOutput(stdout)
      expect(syntheticsHelpText).toContain('datadog-ci synthetics run-tests')
    })
  })
  describe('trace', () => {
    it('can be called', async () => {
      const {stdout} = await execPromise(`${STANDALONE_BINARY_PATH} trace --help`)
      const traceHelpText = sanitizeOutput(stdout)
      expect(traceHelpText).toContain('datadog-ci trace')
    })
  })
})
