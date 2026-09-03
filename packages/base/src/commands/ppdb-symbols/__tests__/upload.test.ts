import type {MultipartFileValue, MultipartPayload, MultipartStringValue} from '@datadog/datadog-ci-base/helpers/upload'

import {createCommand} from '@datadog/datadog-ci-base/helpers/__tests__/testing-tools'
import {TrackedFilesMatcher, getRepositoryData} from '@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'
import {cliVersion} from '@datadog/datadog-ci-base/version'

import {uploadMultipartHelper} from '../helpers'
import {renderArgumentMissingError, renderManifestNotFound, renderMissingManifestEntry} from '../renderer'
import {PpdbSymbolsUploadCommand} from '../upload'

const fixtureDir = 'src/commands/ppdb-symbols/__tests__/fixtures'
const manifestPath = `${fixtureDir}/manifest.json`
const pdbsDir = `${fixtureDir}/pdbs`

jest.mock('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data', () => ({
  ...jest.requireActual('@datadog/datadog-ci-base/helpers/git/format-git-sourcemaps-data'),
  getRepositoryData: jest.fn(),
}))

jest.mock('../helpers', () => ({
  ...jest.requireActual('../helpers'),
  uploadMultipartHelper: jest.fn(),
}))

describe('ppdb-symbols upload', () => {
  const runCommand = async (prepFunction: (command: PpdbSymbolsUploadCommand) => void) => {
    const command = createCommand(PpdbSymbolsUploadCommand)
    prepFunction(command)

    const exitCode = await command.execute()

    return {exitCode, context: command.context}
  }

  beforeEach(() => {
    ;(getRepositoryData as jest.Mock).mockReset()
  })

  describe('parameter validation', () => {
    test('fails if no symbols location is given', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['debugIdManifestPath'] = manifestPath
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderArgumentMissingError('symbols locations'))
    })

    test('fails if the debug ID manifest path is missing', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [pdbsDir]
        cmd['debugIdManifestPath'] = `${fixtureDir}/does-not-exist.json`
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(renderManifestNotFound(`${fixtureDir}/does-not-exist.json`))
    })

    test('fails if the debug ID manifest is not valid JSON', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [pdbsDir]
        cmd['debugIdManifestPath'] = `${fixtureDir}/notJson.json`
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('could not read debug ID manifest')
    })

    test('fails if a symbols location does not exist', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/does-not-exist`]
        cmd['debugIdManifestPath'] = manifestPath
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain(`${fixtureDir}/does-not-exist`)
    })
  })

  describe('upload', () => {
    test('uploads a multipart payload for each .pdb with a matching manifest entry', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [pdbsDir]
        cmd['debugIdManifestPath'] = manifestPath
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(2)

      const calls = (uploadMultipartHelper as jest.Mock).mock.calls
      const uploadedAssemblies = calls.map((call) => {
        const content = call[1].content as Map<string, any>
        const event = JSON.parse((content.get('event') as MultipartStringValue).value)

        return event.assembly_name
      })

      expect(uploadedAssemblies.sort()).toEqual(['MyApp', 'MyApp.Core'])

      const errorOutput = context.stderr.toString() + context.stdout.toString()
      expect(errorOutput).toContain(renderMissingManifestEntry('Untracked', `./${pdbsDir}/Untracked.pdb`))
    })

    test('creates correct metadata payload', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')
      ;(getRepositoryData as jest.Mock).mockResolvedValueOnce({
        hash: 'fake-git-hash',
        remote: 'fake-git-remote',
        trackedFilesMatcher: new TrackedFilesMatcher(['./MyApp.cs']),
      })

      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${pdbsDir}/MyApp.pdb`]
        cmd['debugIdManifestPath'] = manifestPath
      })

      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      const event = JSON.parse((payload.content.get('event') as MultipartStringValue).value)

      expect(event).toEqual({
        cli_version: cliVersion,
        origin_version: cliVersion,
        origin: 'datadog-ci',
        type: 'dotnet_portable_pdb',
        debug_id: 'aabbccdd11223344aabbccdd1122334455667788',
        assembly_name: 'MyApp',
        filename: 'MyApp.pdb',
        overwrite: false,
        git_commit_sha: 'fake-git-hash',
        git_repository_url: 'fake-git-remote',
      })

      const fileValue = payload.content.get('dotnet_portable_pdb') as MultipartFileValue
      expect(fileValue.path).toBe(`${pdbsDir}/MyApp.pdb`)
    })

    test('skips upload on dry run', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [pdbsDir]
        cmd['debugIdManifestPath'] = manifestPath
        cmd['dryRun'] = true
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).not.toHaveBeenCalled()
    })

    test('sets overwrite when --replace-existing is passed', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${pdbsDir}/MyApp.pdb`]
        cmd['debugIdManifestPath'] = manifestPath
        cmd['replaceExisting'] = true
      })

      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      const event = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      expect(event.overwrite).toBe(true)
    })

    test('fails if a symbols location file is not a .pdb', async () => {
      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${fixtureDir}/notapdb.txt`]
        cmd['debugIdManifestPath'] = manifestPath
      })
      const errorOutput = context.stderr.toString()

      expect(exitCode).not.toBe(0)
      expect(errorOutput).toContain('is not a .pdb file')
    })

    test('matches a manifest entry whose casing differs from the .pdb basename', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      const {exitCode} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${pdbsDir}/MyApp.pdb`]
        cmd['debugIdManifestPath'] = `${fixtureDir}/caseMismatchManifest.json`
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      const event = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      expect(event.debug_id).toBe('aabbccdd11223344aabbccdd1122334455667788')
    })

    test('uploads when the manifest debug ID is an empty string, instead of treating it as missing', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      const {exitCode, context} = await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${pdbsDir}/MyApp.pdb`]
        cmd['debugIdManifestPath'] = `${fixtureDir}/emptyDebugIdManifest.json`
      })

      expect(exitCode).toBe(0)
      expect(uploadMultipartHelper).toHaveBeenCalledTimes(1)
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      const event = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      expect(event.debug_id).toBe('')

      const output = context.stdout.toString()
      expect(output).not.toContain(renderMissingManifestEntry('MyApp', `${pdbsDir}/MyApp.pdb`))
    })

    test('does not attach git metadata when --disable-git is passed', async () => {
      ;(uploadMultipartHelper as jest.Mock).mockResolvedValue('')

      await runCommand((cmd) => {
        cmd['symbolsLocations'] = [`${pdbsDir}/MyApp.pdb`]
        cmd['debugIdManifestPath'] = manifestPath
        cmd['disableGit'] = true
      })

      expect(getRepositoryData).not.toHaveBeenCalled()
      const payload = (uploadMultipartHelper as jest.Mock).mock.calls[0][1] as MultipartPayload
      expect(payload.content.has('repository')).toBe(false)
      const event = JSON.parse((payload.content.get('event') as MultipartStringValue).value)
      expect(event.git_commit_sha).toBeUndefined()
      expect(event.git_repository_url).toBeUndefined()
    })
  })
})
