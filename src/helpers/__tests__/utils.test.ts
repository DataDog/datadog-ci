jest.mock('fs')
import {AxiosPromise, AxiosRequestConfig, default as axios} from 'axios'
import fs from 'fs'

import * as ciUtils from '../utils'

jest.useFakeTimers()

describe('utils', () => {
  test('Test pick', () => {
    const initialHash = {a: 1, b: 2}

    let resultHash = ciUtils.pick(initialHash, ['a'])
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1)
    expect(resultHash.a).toBe(1)

    resultHash = ciUtils.pick(initialHash, ['c'] as any)
    expect(Object.keys(resultHash).length).toBe(0)
  })

  describe('parseConfigFile', () => {
    beforeEach(() => {
      jest.restoreAllMocks()
    })
    test('should read a config file', async () => {
      jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({newconfigkey: 'newconfigvalue'}))

      const config: any = await ciUtils.parseConfigFile({})
      expect(config.newconfigkey).toBe('newconfigvalue')
    })

    test('should throw an error if path is provided and config file is not found', async () => {
      jest.spyOn(fs, 'readFile' as any).mockImplementation((a, b, cb: any) => cb({code: 'ENOENT'}))
      const config = ciUtils.parseConfigFile({}, '/veryuniqueandabsentfile')

      await expect(config).rejects.toEqual(Error('Config file not found'))
    })

    test('should throw an error if JSON parsing fails', async () => {
      jest.spyOn(fs, 'readFile' as any).mockImplementation((a, b, cb: any) => cb(undefined, 'thisisnoJSON'))

      await expect(ciUtils.parseConfigFile({})).rejects.toEqual(Error('Config file is not correct JSON'))
    })

    test('config file should overwrite default configuration', async () => {
      jest.spyOn(ciUtils, 'getConfig').mockImplementation(async () => ({configKey: 'newconfigvalue'}))

      const config = await ciUtils.parseConfigFile({configKey: 'configvalue'})
      expect(config.configKey).toBe('newconfigvalue')
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
      const request = ciUtils.getRequestBuilder(requestOptions)
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
      const request = ciUtils.getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      expect(await fakeEndpoint()).toStrictEqual({'DD-API-KEY': 'apiKey', 'DD-APPLICATION-KEY': 'applicationKey'})
    })

    test('should add proxy configuration', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.httpsAgent) as any)
      const proxyOpts: ciUtils.ProxyConfiguration = {protocol: 'http', host: '1.2.3.4', port: 1234}
      const requestOptions = {
        apiKey: 'apiKey',
        appKey: 'applicationKey',
        baseUrl: 'http://fake-base.url/',
        proxyOpts,
      }
      const request = ciUtils.getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      const httpsAgent = await fakeEndpoint()
      expect(httpsAgent).toBeDefined()
      expect((httpsAgent as any).proxyUri).toBe('http://1.2.3.4:1234')
    })

    test('should accept overrideUrl', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.url) as any)
      const requestOptions = {
        apiKey: 'apiKey',
        appKey: 'applicationKey',
        baseUrl: 'http://fake-base.url/',
        overrideUrl: 'override/url',
      }
      const request = ciUtils.getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      expect(await fakeEndpoint()).toStrictEqual('override/url')
    })

    test('should accept additional headers', async () => {
      jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.headers) as any)
      const requestOptions = {
        apiKey: 'apiKey',
        appKey: 'applicationKey',
        baseUrl: 'http://fake-base.url/',
        headers: new Map([
          ['HEADER1', 'value1'],
          ['HEADER2', 'value2'],
        ]),
        overrideUrl: 'override/url',
      }
      const request = ciUtils.getRequestBuilder(requestOptions)
      const fakeEndpoint = fakeEndpointBuilder(request)
      expect(await fakeEndpoint()).toStrictEqual({
        'DD-API-KEY': 'apiKey',
        'DD-APPLICATION-KEY': 'applicationKey',
        HEADER1: 'value1',
        HEADER2: 'value2',
      })
    })
  })

  describe('getApiHostForSite', () => {
    it.each([
      ['datad0g.com', 'app.datad0g.com'],
      ['datadoghq.com', 'api.datadoghq.com'],
      ['datadoghq.eu', 'api.datadoghq.eu'],
      ['whitelabel.com', 'api.whitelabel.com'],
    ])('for site = %p, returns api host = %p ', (site, expectedApiHost) => {
      expect(ciUtils.getApiHostForSite(site)).toEqual(expectedApiHost)
    })
  })

  describe('buildPath', () => {
    test('should return correct path', () => {
      const pathWithNoTrailingSlash = 'sourcemaps/js'
      const pathWithTrailingSlash = 'sourcemaps/js/'
      const fileName = 'file1.min.js'

      expect(ciUtils.buildPath(pathWithNoTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
      expect(ciUtils.buildPath(pathWithTrailingSlash, fileName)).toBe('sourcemaps/js/file1.min.js')
    })
  })

  describe('getProxyUrl', () => {
    test('should return correct proxy URI', () => {
      expect(ciUtils.getProxyUrl({protocol: 'http'})).toBe('')
      expect(ciUtils.getProxyUrl({host: '127.0.0.1', protocol: 'http'})).toBe('')
      expect(ciUtils.getProxyUrl({host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe('http://127.0.0.1:1234')

      const auth = {password: 'pwd', username: 'john'}
      expect(ciUtils.getProxyUrl({auth, host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe(
        'http://john:pwd@127.0.0.1:1234'
      )
      expect(ciUtils.getProxyUrl({auth, protocol: 'http'})).toBe('')
    })
  })
})
