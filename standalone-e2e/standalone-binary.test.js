const util = require('util')
const {version} = require('../package.json')
const exec = util.promisify(require('child_process').exec)

const STANDALONE_BINARY_PATH = './datadog-ci'

function sanitizeOutput(output) {
  return output.replace(/(\r\n|\n|\r)/gm, '')
}

describe('standalone binary', () => {
  describe('version', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} version`)
      const binaryVersion = sanitizeOutput(stdout)
      // .slice(1) to remove the "v"
      expect(binaryVersion.slice(1)).toEqual(version)
    })
  })
  describe('dependencies', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} dependencies upload --help`)
      const dependenciesHelpText = sanitizeOutput(stdout)
      expect(dependenciesHelpText).toContain('Upload dependencies graph to Datadog.')
    })
  })
  describe('dsyms', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} dsyms upload --help`)
      const dsymsHelpText = sanitizeOutput(stdout)
      expect(dsymsHelpText).toContain('Upload dSYM files to Datadog.')
    })
  })
  describe('git-metadata', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} git-metadata upload --help`)
      const gitMetadataHelpText = sanitizeOutput(stdout)
      expect(gitMetadataHelpText).toContain('Report the current commit details to Datadog.')
    })
  })
  describe('junit', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} junit upload --help`)
      const junitHelpText = sanitizeOutput(stdout)
      expect(junitHelpText).toContain('Upload jUnit XML test reports files to Datadog.')
    })
  })
  describe('lambda', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} lambda instrument --help`)
      const lambdaHelpText = sanitizeOutput(stdout)
      expect(lambdaHelpText).toContain(
        'datadog-ci lambda instrument [-f,--function #0] [--functions-regex,--functionsRegex #0]'
      )
    })
  })
  describe('sourcemaps', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} sourcemaps upload --help`)
      const sourceMapsHelpText = sanitizeOutput(stdout)
      expect(sourceMapsHelpText).toContain('Upload javascript sourcemaps to Datadog.')
    })
  })
  describe('synthetics', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} synthetics run-tests --help`)
      const syntheticsHelpText = sanitizeOutput(stdout)
      expect(syntheticsHelpText).toContain(
        'datadog-ci synthetics run-tests [--apiKey #0] [--appKey #0] [--config #0] [--datadogSite #0] [--failOnCriticalErrors]'
      )
    })
  })
  describe('trace', () => {
    it('can be called', async () => {
      const {stdout} = await exec(`${STANDALONE_BINARY_PATH} trace --help`)
      const traceHelpText = sanitizeOutput(stdout)
      expect(traceHelpText).toContain('Trace a command with a custom span and report it to Datadog.')
    })
  })
})
