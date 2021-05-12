jest.mock('fs')

import * as fs from 'fs'

import {AxiosPromise, AxiosRequestConfig, default as axios} from 'axios'

import {
  buildPath,
  getApiHostForSite,
  getProxyUrl,
  getRequestBuilder,
  parseConfigFile,
  pick,
  ProxyConfiguration,
} from '../utils'

jest.useFakeTimers()

describe('utils', () => {
  test('Test pick', () => {
    const initialHash = {a: 1, b: 2}

    let resultHash = pick(initialHash, ['a'])
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1)
    expect(resultHash.a).toBe(1)

    resultHash = pick(initialHash, ['c'] as any)
    expect(Object.keys(resultHash).length).toBe(0)
  })

  describe('parseConfigFile', () => {
    afterEach(() => {
      ;(fs.readFile as any).mockRestore()
    })

    test('should read a config file', async () => {
      ;(fs.readFile as any).mockImplementation((_path: string, _opts: any, callback: any) =>
        callback(undefined, '{"newconfigkey":"newconfigvalue"}')
      )

      const config: any = await parseConfigFile({})
      expect(config.newconfigkey).toBe('newconfigvalue')
    })

    test('should throw an error if path is provided and config file is not found', async () => {
      ;(fs.readFile as any).mockImplementation((a: any, b: any, callback: any) => callback({code: 'ENOENT'}))
      const config = parseConfigFile({}, '/veryuniqueandabsentfile')

      await expect(config).rejects.toEqual(Error('Config file not found'))
    })

    test('should throw an error if JSON parsing fails', async () => {
      ;(fs.readFile as any).mockImplementation((p: string, o: any, cb: any) => cb(undefined, 'thisisnoJSON'))

      await expect(parseConfigFile({})).rejects.toEqual(Error('Config file is not correct JSON'))
    })

    test('config file should overwrite default configuration', async () => {
      ;(fs.readFile as any).mockImplementation((_path: string, _opts: any, callback: any) =>
        callback(undefined, '{"configKey":"newconfigvalue"}')
      )

      const config = await parseConfigFile({configKey: 'configvalue'})
      await expect(config.configKey).toBe('newconfigvalue')
    })
  })

  describe('getRequestBuilder', () => {
    const fakeEndpointBuilder = (request: (args: AxiosRequestConfig) => AxiosPromise) => async () => request({})

    test('should add api key header', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.headers) as any)
      const requestOptions = {
        apiKey: 'apiKey',
        baseUrl: 'http://fake-base.url/',
      }
      const request = getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      expect(await fakeEndpoint()).toStrictEqual({'DD-API-KEY': 'apiKey'})
    })

    test('should add api and application key header', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.headers) as any)
      const requestOptions = {
        apiKey: 'apiKey',
        appKey: 'applicationKey',
        baseUrl: 'http://fake-base.url/',
      }
      const request = getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      expect(await fakeEndpoint()).toStrictEqual({'DD-API-KEY': 'apiKey', 'DD-APPLICATION-KEY': 'applicationKey'})
    })

    test('should add proxy configuration', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.httpsAgent) as any)
      const proxyOpts: ProxyConfiguration = {protocol: 'http', host: '1.2.3.4', port: 1234}
      const requestOptions = {
        apiKey: 'apiKey',
        appKey: 'applicationKey',
        baseUrl: 'http://fake-base.url/',
        proxyOpts,
      }
      const request = getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      const httpsAgent = await fakeEndpoint()
      expect(httpsAgent).toBeDefined()
      expect((httpsAgent as any).proxyUri).toBe('http://1.2.3.4:1234')
    })
  })

  describe('getApiHostForSite', () => {
    it.each([
      ['datad0g.com', 'app.datad0g.com'],
      ['datadoghq.com', 'api.datadoghq.com'],
      ['datadoghq.eu', 'api.datadoghq.eu'],
      ['whitelabel.com', 'api.whitelabel.com'],
    ])('for site = %p, returns api host = %p ', (site, expectedApiHost) => {
      expect(getApiHostForSite(site)).toEqual(expectedApiHost)
    })
  })

  describe('buildPath', () => {
    test('should return correct path', () => {
      const pathWithNoTrailingSlash = 'sourcemaps/js'
      const pathWithTrailingSlash = 'sourcemaps/js/'
      const fileName = 'file1.min.js'

      expect(buildPath(pathWithNoTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
      expect(buildPath(pathWithTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
    })
  })

  describe('getProxyUrl', () => {
    test('should return correct proxy URI', () => {
      expect(getProxyUrl({protocol: 'http'})).toBe('')
      expect(getProxyUrl({host: '127.0.0.1', protocol: 'http'})).toBe('')
      expect(getProxyUrl({host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe('http://127.0.0.1:1234')

      const auth = {password: 'pwd', username: 'john'}
      expect(getProxyUrl({auth, host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe(
        'http://john:pwd@127.0.0.1:1234'
      )
      expect(getProxyUrl({auth, protocol: 'http'})).toBe('')
    })
  })
})
