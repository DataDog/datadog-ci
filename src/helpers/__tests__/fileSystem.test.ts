import fs from 'fs'
import path from 'path'
import process from 'process'

import {deleteFolder} from '../fileSystem'

// Mock constants
const MOCK_CWD = 'mock-cwd'
const MOCK_FOLDER_NAME = 'mock-folder'
const MOCK_FOLDER_PATH = path.join(MOCK_CWD, MOCK_FOLDER_NAME)

// Mocks
process.cwd = jest.fn().mockReturnValue(MOCK_CWD)
jest.mock('fs')

describe('fileSystem', () => {
  describe('deleteFolder', () => {
    it('successfully deletes a folder', async () => {
      deleteFolder(MOCK_FOLDER_PATH)

      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH, {recursive: true, force: true})
    })

    it('throws error when unable to delete a folder', async () => {
      ;(fs.rmSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to delete folder')
      })

      expect(() => deleteFolder(MOCK_FOLDER_PATH)).toThrowErrorMatchingSnapshot()
      expect(fs.rmSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH, {recursive: true, force: true})
      ;(fs.rmSync as jest.Mock).mockRestore()
    })
  })
})
