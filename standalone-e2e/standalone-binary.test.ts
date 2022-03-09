import {exec} from 'child_process'
import {promisify} from 'util'

import {version} from '../package.json'

const execPromise = promisify(exec)

const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'macos' : 'linux'

const STANDALONE_BINARY_PATH = `./datadog-ci-${os}`

const sanitizeOutput = (output: string) => output.replace(/(\r\n|\n|\r)/gm, '')

describe('standalone binary', () => {
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
