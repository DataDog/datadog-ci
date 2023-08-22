import fs from 'fs'
import process from 'process'

import axios from 'axios'
import FormData from 'form-data'

import {CI_SITE_ENV_VAR, FLARE_PROJECT_FILES, SITE_ENV_VAR} from '../../constants'

import {getEndpointUrl, getProjectFiles, sendToDatadog, validateFilePath, validateStartEndFlags} from '../flare'
import * as flareModule from '../flare'

import {MOCK_CWD} from './fixtures'

// Mocks
jest.mock('fs')
jest.spyOn(process, 'cwd').mockReturnValue(MOCK_CWD)
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
    const MOCK_AXIOS = axios as jest.Mocked<typeof axios>

    it('should send data to the correct endpoint', async () => {
      await sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      expect(MOCK_AXIOS.post).toHaveBeenCalledWith(
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
      const error = new Error('Network error')
      MOCK_AXIOS.post.mockRejectedValueOnce({
        isAxiosError: true,
        message: error.message,
        response: {data: {error: 'Server error'}},
      })

      const fn = sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      await expect(fn).rejects.toThrow(`Failed to send flare file to Datadog Support: ${error.message}. Server error\n`)
    })

    it('prints correct warning when post fail with error 500', async () => {
      MOCK_AXIOS.post.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Some error',
        response: {status: 500, data: {error: 'Server error'}},
      })

      const fn = sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      await expect(fn).rejects.toThrow(
        `Failed to send flare file to Datadog Support: Some error. Server error\nAre your case ID and email correct?\n`
      )
    })

    it('prints correct warning when post fail with error 403', async () => {
      MOCK_AXIOS.post.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Some error',
        response: {status: 403, data: {error: 'Another error'}},
      })

      const fn = sendToDatadog(MOCK_ZIP_PATH, MOCK_CASE_ID, MOCK_EMAIL, MOCK_API_KEY, MOCK_ROOT_FOLDER_PATH)
      await expect(fn).rejects.toThrow(
        `Failed to send flare file to Datadog Support: Some error. Another error\nIs your Datadog API key correct?\n`
      )
    })
  })

  describe('getProjectFiles', () => {
    beforeAll(() => {
      ;(flareModule.getProjectFiles as jest.Mock).mockRestore()
      ;(process.cwd as jest.Mock).mockReturnValue('')
    })

    it('should return a map of existing project files', async () => {
      const mockFiles = ['serverless.yml', 'package.json']
      ;(fs.existsSync as jest.Mock).mockImplementation((filePath: string) => mockFiles.includes(filePath))

      const result = await getProjectFiles(FLARE_PROJECT_FILES)
      expect(Array.from(result.keys())).toEqual(['package.json'])
      expect(fs.existsSync).toHaveBeenCalledTimes(FLARE_PROJECT_FILES.length)
    })

    it('should return an empty map when no files exist', async () => {
      ;(fs.existsSync as jest.Mock).mockReturnValue(false)

      const result = await getProjectFiles(FLARE_PROJECT_FILES)
      expect(result).toEqual(new Set())
      expect(fs.existsSync).toHaveBeenCalledTimes(FLARE_PROJECT_FILES.length)
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

  describe('validateStartEndFlags', () => {
    beforeEach(() => {
      jest.useFakeTimers({now: new Date(Date.UTC(2023, 0))})
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('returns [undefined, undefined] when start and end flags are not specified', () => {
      const errorMessages: string[] = []
      const res = validateStartEndFlags(undefined, undefined)
      expect(res).toEqual([undefined, undefined])
      expect(errorMessages).toEqual([])
    })

    it('throws error when start is specified but end is not specified', () => {
      expect(() => validateStartEndFlags('123', undefined)).toThrowErrorMatchingSnapshot()
    })

    it('throws error when end is specified but start is not specified', () => {
      expect(() => validateStartEndFlags(undefined, '123')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when start is invalid', () => {
      expect(() => validateStartEndFlags('123abc', '200')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when end is invalid', () => {
      expect(() => validateStartEndFlags('100', '234abc')).toThrowErrorMatchingSnapshot()
    })

    it('throws error when start is not before the end time', () => {
      expect(() => validateStartEndFlags('200', '100')).toThrowErrorMatchingSnapshot()
    })

    it('sets end time to current time if end time is too large', () => {
      const now = Date.now()
      const res = validateStartEndFlags('0', '9999999999999')
      expect(res).not.toBeUndefined()
      const [start, end] = res
      expect(start).toBe(0)
      expect(end).toBeLessThan(9999999999999)
      expect(end).toStrictEqual(now)
    })
  })
})
