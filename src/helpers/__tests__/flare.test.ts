import fs from 'fs'
import process from 'process'

import axios from 'axios'
import FormData from 'form-data'

import {PROJECT_FILES} from '../../commands/lambda/constants'
import {CI_SITE_ENV_VAR, SITE_ENV_VAR} from '../../constants'

import {getEndpointUrl, getProjectFiles, sendToDatadog, validateFilePath} from '../flare'
import * as flareModule from '../flare'

import {MOCK_CWD} from './fixtures'

// Mocks
jest.mock('fs')
process.cwd = jest.fn().mockReturnValue(MOCK_CWD)
jest.spyOn(flareModule, 'getProjectFiles').mockResolvedValue(new Set())
fs.createReadStream = jest.fn().mockReturnValue('test data')
jest.mock('jszip')

describe('flare', () => {
  describe('getEndpointUrl', () => {
    const ORIGINAL_ENV = process.env

    beforeEach(() => {
      process.env = {...ORIGINAL_ENV}
    })

    afterAll(() => {
      process.env = ORIGINAL_ENV
    })

    it('should return correct endpoint url', () => {
      process.env[CI_SITE_ENV_VAR] = 'datadoghq.com'
      const url = getEndpointUrl()
      expect(url).toMatchSnapshot()
    })

    it('should throw error if the site is invalid', () => {
      process.env[CI_SITE_ENV_VAR] = 'datad0ge.com'
      expect(() => getEndpointUrl()).toThrowErrorMatchingSnapshot()
    })

    it('should not throw error if the site is invalid and DD_CI_BYPASS_SITE_VALIDATION is set', () => {
      process.env['DD_CI_BYPASS_SITE_VALIDATION'] = 'true'
      process.env[CI_SITE_ENV_VAR] = 'datad0ge.com'
      const url = getEndpointUrl()
      expect(url).toMatchSnapshot()
      delete process.env['DD_CI_BYPASS_SITE_VALIDATION']
    })

    it('should use SITE_ENV_VAR if CI_SITE_ENV_VAR is not set', () => {
      delete process.env[CI_SITE_ENV_VAR]
      process.env[SITE_ENV_VAR] = 'us3.datadoghq.com'
      const url = getEndpointUrl()
      expect(url).toMatchSnapshot()
    })

    it('should use DEFAULT_DD_SITE if CI_SITE_ENV_VAR and SITE_ENV_VAR are not set', () => {
      delete process.env[CI_SITE_ENV_VAR]
      delete process.env[SITE_ENV_VAR]
      const url = getEndpointUrl()
      expect(url).toMatchSnapshot()
    })
  })

  describe('sendToDatadog', () => {
    const MOCK_ZIP_PATH = '/path/to/zip'
    const MOCK_CASE_ID = 'case1234'
    const MOCK_EMAIL = 'test@example.com'
    const MOCK_API_KEY = 'api-key'
    const MOCK_ROOT_FOLDER_PATH = '/root/folder/path'

    it('should send data to the correct endpoint', async () => {
      const mockAxios = axios as jest.Mocked<typeof axios>

      await sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      expect(mockAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            'DD-API-KEY': MOCK_API_KEY,
          }),
        })
      )
    })

    it('should delete root folder and rethrow error if request fails', async () => {
      const mockAxios = axios as jest.Mocked<typeof axios>
      const error = new Error('Network error')
      mockAxios.post.mockRejectedValueOnce({
        isAxiosError: true,
        message: error.message,
        response: {data: {error: 'Server error'}},
      })

      const fn = sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      await expect(fn).rejects.toThrow(`Failed to send flare file to Datadog Support: ${error.message}. Server error\n`)
    })
  })

  describe('getProjectFiles', () => {
    beforeAll(() => {
      ;(flareModule.getProjectFiles as jest.Mock).mockRestore()
      ;(process.cwd as jest.Mock).mockReturnValue('')
    })

    it('should return a map of existing project files', async () => {
      const mockProjectFiles = ['serverless.yml', 'package.json']
      ;(fs.existsSync as jest.Mock).mockImplementation((filePath: string) => mockProjectFiles.includes(filePath))

      const result = await getProjectFiles()
      expect(Array.from(result.keys())).toEqual(mockProjectFiles)
      expect(fs.existsSync).toHaveBeenCalledTimes(PROJECT_FILES.length)
    })

    it('should return an empty map when no files exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const result = await getProjectFiles()
      expect(result).toEqual(new Set())
      expect(fs.existsSync).toHaveBeenCalledTimes(PROJECT_FILES.length)
    })
  })

  describe('validateFilePath', () => {
    const projectFilePaths = new Set<string>()
    const additionalFilePaths = new Set<string>()

    it('returns the correct path when the file exists', () => {
      const filePath = '/exists'

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      const result = validateFilePath(filePath, projectFilePaths, additionalFilePaths)

      expect(result).toBe(filePath)
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })

    it('returns the correct path when the file exists relative to the cwd', () => {
      const filePath = 'relative'

      ;(fs.existsSync as jest.Mock).mockReturnValueOnce(false).mockReturnValueOnce(true)

      const result = validateFilePath(filePath, projectFilePaths, additionalFilePaths)

      expect(result).toContain(filePath)
      expect(fs.existsSync).toHaveBeenNthCalledWith(1, filePath)
      expect(fs.existsSync).toHaveBeenCalledTimes(2)
    })

    it('throws an error when the file does not exist', async () => {
      const filePath = '/not-exists'

      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      expect(() => validateFilePath(filePath, projectFilePaths, additionalFilePaths)).toThrowErrorMatchingSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })

    it('throws an error when the file has already been added', async () => {
      const filePath = '/added'

      ;(fs.existsSync as jest.Mock).mockReturnValue(true)
      projectFilePaths.add(filePath)

      expect(() => validateFilePath(filePath, projectFilePaths, additionalFilePaths)).toThrowErrorMatchingSnapshot()
      expect(fs.existsSync).toHaveBeenCalledWith(filePath)
    })
  })
})
