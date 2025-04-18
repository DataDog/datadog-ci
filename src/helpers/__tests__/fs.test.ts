import fs from 'fs'
import path from 'path'
import process from 'process'

import JSZip from 'jszip'

import {createDirectories, deleteFolder, writeFile, zipContents} from '../fs'

import {MOCK_DATADOG_API_KEY} from './testing-tools'

// Mock constants
const MOCK_CWD = 'mock-cwd'
const MOCK_FOLDER_NAME = 'mock-folder'
const MOCK_FOLDER_PATH = path.join(MOCK_CWD, MOCK_FOLDER_NAME)
const MOCK_FILE_NAME = 'function_config.json'
const MOCK_ZIP_PATH = 'output.zip'
const MOCK_FILES = new Set([MOCK_FILE_NAME, 'file1.csv', 'file2.csv', 'file3.csv'])
const MOCK_LAMBDA_CONFIG = {
  Environment: {
    Variables: {
      DD_API_KEY: MOCK_DATADOG_API_KEY,
      DD_SITE: 'datadoghq.com',
      DD_LOG_LEVEL: 'debug',
    },
  },
  FunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:some-function',
  FunctionName: 'some-function',
}

// fs mocks
jest.spyOn(process, 'cwd').mockReturnValue(MOCK_CWD)
jest.mock('fs')
;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
  isDirectory: () => file_path === MOCK_FOLDER_PATH || file_path === MOCK_CWD,
}))

// Zip mocks
jest.mock('jszip')
const mockJSZip = {
  file: jest.fn(),
  generateAsync: jest.fn().mockResolvedValue('zip content'),
}
;(JSZip as any).mockImplementation(() => mockJSZip)

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

  describe('writeFile', () => {
    const MOCK_DATA = 'mock data'
    ;(fs.existsSync as jest.Mock).mockReturnValue(false)

    it('successfully writes data to a file with no error', async () => {
      writeFile(MOCK_FILE_NAME, MOCK_DATA)

      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_NAME, MOCK_DATA)
    })

    it('throws error when unable to write data to a file', async () => {
      ;(fs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      expect(() => writeFile(MOCK_FILE_NAME, MOCK_DATA)).toThrowErrorMatchingSnapshot()
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_FILE_NAME, MOCK_DATA)
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
    })
  })

  describe('zipContents', () => {
    ;(fs.existsSync as jest.Mock).mockReturnValue(true)
    ;(fs.readdirSync as jest.Mock).mockImplementation((file_path: string) =>
      file_path === MOCK_FOLDER_PATH ? Array.from(MOCK_FILES) : []
    )

    it('successfully zips the contents of a file', async () => {
      await zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)

      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.readdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalledWith(MOCK_ZIP_PATH, 'zip content')
    })

    it('throws error when path is not found', async () => {
      ;(fs.existsSync as any).mockReturnValue(false)

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.existsSync as any).mockReturnValue(true)
    })

    it('throws error when path is not a directory', async () => {
      ;(fs.statSync as any).mockReturnValue({isDirectory: () => false})

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.statSync).toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.statSync as jest.Mock).mockImplementation((file_path: string) => ({
        isDirectory: () => file_path === MOCK_FOLDER_PATH || file_path === MOCK_CWD,
      }))
    })

    it('throws error when unable to read file', async () => {
      ;(fs.readFileSync as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to read file')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalled()
      expect(mockJSZip.file).not.toHaveBeenCalled()
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(fs.readFileSync as any).mockReturnValue(JSON.stringify(MOCK_LAMBDA_CONFIG, undefined, 2))
    })

    it('throws error when unable to write file', async () => {
      ;(mockJSZip.file as any).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to write file')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalled()
      expect(mockJSZip.file).toHaveBeenCalled()
      expect(mockJSZip.generateAsync).not.toHaveBeenCalled()
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      ;(mockJSZip.file as any).mockImplementation(() => {})
    })

    it('throws error when unable to generate zip', async () => {
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to generate zip')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalled()
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).not.toHaveBeenCalled()

      // Reset mock
      mockJSZip.generateAsync = jest.fn().mockImplementation(() => 'zip content')
    })

    it('throws error when unable to save zip', async () => {
      fs.writeFileSync = jest.fn().mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to save zip')
      })

      await expect(zipContents(MOCK_FOLDER_PATH, MOCK_ZIP_PATH)).rejects.toMatchSnapshot()

      expect(fs.readFileSync).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.file).toHaveBeenCalledTimes(MOCK_FILES.size)
      expect(mockJSZip.generateAsync).toHaveBeenCalledWith({type: 'nodebuffer'})
      expect(fs.writeFileSync).toHaveBeenCalled()

      // Reset mock
      fs.writeFileSync = jest.fn().mockImplementation(() => {})
    })
  })

  describe('createDirectories', () => {
    const MOCK_LOG_PATH = path.join(MOCK_FOLDER_PATH, 'logs')

    it('successfully creates a root folder', async () => {
      createDirectories(MOCK_FOLDER_PATH, [])

      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
    })

    it('successfully creates a root and logs folder', async () => {
      createDirectories(MOCK_FOLDER_PATH, [MOCK_LOG_PATH])

      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_LOG_PATH)
    })

    it('throws error when unable to create a folder', async () => {
      ;(fs.mkdirSync as jest.Mock).mockImplementation(() => {
        throw new Error('MOCK ERROR: Unable to create folder')
      })

      expect(() => createDirectories(MOCK_FOLDER_PATH, [])).toThrowErrorMatchingSnapshot()
      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_FOLDER_PATH)
      fs.mkdirSync = jest.fn().mockImplementation(() => {})
    })
  })
})
