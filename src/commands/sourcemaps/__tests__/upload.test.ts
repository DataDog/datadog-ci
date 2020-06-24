// tslint:disable: no-string-literal
jest.mock('glob')
import glob from 'glob'

import {UploadCommand} from '../upload'

describe('upload', () => {
  describe('getMinifiedURL', () => {
    test('should return correct URL', () => {
      const command = new UploadCommand()
      command['basePath'] = '/js/sourcemaps'
      command['minifiedPathPrefix'] = 'http://datadog.com/js'
      expect(command['getMinifiedURL']('/js/sourcemaps/common.min.js.map')).toBe(
        'http://datadog.com/js/common.min.js.map'
      )
    })
  })
  describe('getMatchingSourcemapsFiles', () => {
    const FILES = ['folder1/file1.min.js.map', 'folder2/file2.js.map']
    ;(glob as any).sync.mockImplementation((query: string) => FILES)
    const command = new UploadCommand()
    command['basePath'] = '/js/sourcemaps'
    command['minifiedPathPrefix'] = 'http://datadog.com/js'
    command['service'] = 'web-ui'
    command['releaseVersion'] = '42'

    const files = command['getMatchingSourcemapFiles']()

    expect(files[0]).toStrictEqual({
      minifiedFilePath: 'folder1/file1.min.js',
      minifiedUrl: 'http://datadog.com/js/folder1/file1.min.js',
      projectPath: '',
      service: 'web-ui',
      sourcemapPath: 'folder1/file1.min.js.map',
      version: '42',
    })

    expect(files[1]).toStrictEqual({
      minifiedFilePath: 'folder2/file2.js',
      minifiedUrl: 'http://datadog.com/js/folder2/file2.js',
      projectPath: '',
      service: 'web-ui',
      sourcemapPath: 'folder2/file2.js.map',
      version: '42',
    })
  })

  describe('getApiHelper', () => {
    test('should throw an error if API key is undefined', async () => {
      process.env = {}
      const write = jest.fn()
      const command = new UploadCommand()
      command.context = {stdout: {write}} as any

      expect(command['getApiHelper'].bind(command)).toThrow('API key is missing')
      expect(write.mock.calls[0][0]).toContain('DATADOG_API_KEY')
    })
  })
})
