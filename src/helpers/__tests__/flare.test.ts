import fs from 'fs'
import process from 'process'

import axios from 'axios'
import FormData from 'form-data'

import {CI_SITE_ENV_VAR, SITE_ENV_VAR} from '../../constants'

import {getEndpointUrl, sendToDatadog} from '../flare'

jest.mock('jszip')
jest.mock('fs')
fs.createReadStream = jest.fn().mockReturnValue('test data')

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
})
