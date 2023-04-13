import {exec} from 'child_process'
import {promisify} from 'util'

import {version} from '../package.json'

const execPromise = promisify(exec)

const isWin = process.platform === 'win32'

const os = isWin ? 'win' : process.platform === 'darwin' ? 'darwin' : 'linux'

const STANDALONE_BINARY = `datadog-ci_${os}-x64`

const STANDALONE_BINARY_PATH = `${isWin ? '.\\' : './'}${STANDALONE_BINARY}${isWin ? '.exe' : ''}`

const sanitizeOutput = (output: string) => output.replace(/(\r\n|\n|\r)/gm, '')

describe('standalone binary', () => {
  beforeAll(
    async () => {
      // Run the binary with no CLI arguments.
      await expect(execPromise(`${STANDALONE_BINARY_PATH}`, {})).rejects.toThrow(
        expect.objectContaining({
          code: 1,
          stdout: expect.stringContaining('Unknown Syntax Error'),
        })
      )
    },
    // The cold start of the binary sometimes takes >5s on macOS, resulting in a flaky CI for this OS.
    // This `beforeAll` is here to warm up the binary.
    6 * 1000
  )

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
