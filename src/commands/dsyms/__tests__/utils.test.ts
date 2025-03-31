import fs, {promises} from 'fs'

import {glob} from 'glob'

import {buildPath} from '../../../helpers/utils'

import {
  createUniqueTmpDirectory,
  deleteDirectory,
  isZipFile,
  unzipArchiveToDirectory,
  zipDirectoryToArchive,
} from '../utils'

describe('utils', () => {
  describe('createTmpDirectory', () => {
    test('Create unique directory', async () => {
      const tmpDirectory1 = await createUniqueTmpDirectory()
      const tmpDirectory2 = await createUniqueTmpDirectory()

      expect(fs.existsSync(tmpDirectory1)).toBeTruthy()
      expect(fs.existsSync(tmpDirectory2)).toBeTruthy()
      expect(tmpDirectory1).not.toEqual(tmpDirectory2)

      await deleteDirectory(tmpDirectory1)
      await deleteDirectory(tmpDirectory2)
    })
  })

  describe('deleteDirectory', () => {
    test('Delete empty directory', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()

      await deleteDirectory(tmpDirectory)

      expect(fs.existsSync(tmpDirectory)).toBeFalsy()
    })

    test('Delete non-empty directory', async () => {
      const tmpDirectory = await createUniqueTmpDirectory()
      await promises.mkdir(buildPath(tmpDirectory, 'foo'))
      await promises.writeFile(buildPath(tmpDirectory, 'foo', 'bar1'), 'mock1')
      await promises.writeFile(buildPath(tmpDirectory, 'foo', 'bar2'), 'mock2')

      await deleteDirectory(tmpDirectory)

      expect(fs.existsSync(tmpDirectory)).toBeFalsy()
    })
  })

  describe('zipDirectoryToArchive', () => {
    test('Compress folder to archive at given path', async () => {
      const archiveDirectory = await createUniqueTmpDirectory()
      const archivePath = buildPath(archiveDirectory, 'archive.zip')

      await zipDirectoryToArchive('./src/commands/dsyms/__tests__/fixtures', archivePath)

      expect(fs.existsSync(archivePath)).toBeTruthy()

      await deleteDirectory(archiveDirectory)
    })
  })

  describe('unzipArchiveToDirectory', () => {
    test('Uncompress archive to given destination', async () => {
      const archiveDirectory = await createUniqueTmpDirectory()
      const destinationDirectory = await createUniqueTmpDirectory()
      const archivePath = buildPath(archiveDirectory, 'archive.zip')
      await zipDirectoryToArchive('./src/commands/dsyms/__tests__/fixtures', archivePath)

      await unzipArchiveToDirectory(archivePath, destinationDirectory)

      const originalContentList = glob.sync(buildPath('./src/commands/dsyms/__tests__/', 'fixtures/**/*'))
      const unzippedContentList = glob.sync(buildPath(destinationDirectory, 'fixtures/**/*'))
      expect(originalContentList.length).toEqual(unzippedContentList.length)

      await deleteDirectory(archiveDirectory)
      await deleteDirectory(destinationDirectory)
    })
  })

  describe('isZipFile', () => {
    test('Zip file should return true', async () => {
      const file = './src/commands/dsyms/__tests__/fixtures/all.zip'
      expect(await isZipFile(file)).toBeTruthy()
    })

    test('Arbitrary file should return false', async () => {
      const file = './src/commands/dsyms/__tests__/fixtures/multiple-archs/DDTest.framework.dSYM'
      expect(await isZipFile(file)).toBeFalsy()
    })
  })
})
