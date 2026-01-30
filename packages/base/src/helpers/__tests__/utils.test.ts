import http from 'http'
import {AddressInfo} from 'net'

import type {AxiosPromise, AxiosRequestConfig} from 'axios'

import axios from 'axios'
import {createProxy} from 'proxy'
import {ProxyAgent} from 'proxy-agent'

import * as ciUtils from '../utils'
import {formatBytes, isFile, maskString} from '../utils'

import {MOCK_DATADOG_API_KEY} from './testing-tools'

describe('utils', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('pick', () => {
    const initialHash = {a: 1, b: 2}

    let resultHash = ciUtils.pick(initialHash, ['a'])
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1)
    expect(resultHash.a).toBe(1)

    resultHash = ciUtils.pick(initialHash, ['c'] as any)
    expect(Object.keys(resultHash).length).toBe(0)
  })

  describe('resolveConfigFromFile', () => {
    test('should read a config file', async () => {
      const config: any = await ciUtils.resolveConfigFromFile(
        {},
        {configPath: 'src/helpers/__tests__/config-file-fixtures/dummy-config-file.json'}
      )
      expect(config.configKey).toBe('newconfigvalue')
    })

    test('should throw an error if path is provided and config file is not found', async () => {
      const config = ciUtils.resolveConfigFromFile({}, {configPath: '/veryuniqueandabsentfile'})

      await expect(config).rejects.toEqual(Error('Config file not found'))
    })

    test('should have no effect if no config path is provided and default file is absent', async () => {
      const originalConfig = {}
      const config = await ciUtils.resolveConfigFromFile(originalConfig, {
        defaultConfigPaths: ['/veryuniqueandabsentfile'],
      })

      expect(config).toEqual(originalConfig)
    })

    test('should have no effect if no config path nor default path are provided', async () => {
      const originalConfig = {}
      const config = await ciUtils.resolveConfigFromFile(originalConfig, {})

      expect(config).toEqual(originalConfig)
    })

    test('should throw an error if JSON parsing fails', async () => {
      await expect(
        ciUtils.resolveConfigFromFile({}, {configPath: 'src/helpers/__tests__/config-file-fixtures/bad-json.json'})
      ).rejects.toEqual(Error('Config file is not correct JSON'))
    })

    test('config file should overwrite default configuration', async () => {
      const config: any = await ciUtils.resolveConfigFromFile(
        {configKey: 'oldValue'},
        {configPath: 'src/helpers/__tests__/config-file-fixtures/dummy-config-file.json'}
      )
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

    describe('proxy configuration', () => {
      test('should have a ProxyAgent by default', async () => {
        const httpsAgent = await getHttpAgentForProxyOptions()
        expect(httpsAgent).toBeDefined()
        expect(httpsAgent).toBeInstanceOf(ProxyAgent)
      })

      test('should add proxy configuration when explicitly defined', async () => {
        const httpsAgent = await getHttpAgentForProxyOptions({protocol: 'http', host: '1.2.3.4', port: 1234})
        expect(httpsAgent).toBeDefined()
        expect((httpsAgent as any).getProxyForUrl()).toBe('http://1.2.3.4:1234')
      })

      test('should re-use the same proxy agent for the same proxy options', async () => {
        const httpsAgent1 = await getHttpAgentForProxyOptions({protocol: 'http', host: '1.2.3.4', port: 1234})
        const httpsAgent2 = await getHttpAgentForProxyOptions({protocol: 'http', host: '1.2.3.4', port: 1234})
        expect(httpsAgent1).toBe(httpsAgent2)
      })

      const getHttpAgentForProxyOptions = async (proxyOpts?: ciUtils.ProxyConfiguration) => {
        jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.httpsAgent) as any)
        const requestOptions = {
          apiKey: 'apiKey',
          appKey: 'applicationKey',
          baseUrl: 'http://fake-base.url/',
          proxyOpts,
        }
        const request = ciUtils.getRequestBuilder(requestOptions)
        const fakeEndpoint = fakeEndpointBuilder(request)

        return fakeEndpoint()
      }
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
      ['prtest07.datadoghq.com', 'api.prtest07.datadoghq.com'],
      ['whitelabel.com', 'api.whitelabel.com'],
    ])('for site = %p, returns api host = %p', (site, expectedApiHost) => {
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
      expect(ciUtils.getProxyUrl()).toBe('')
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

  // Test the different possibilities of proxy configuration of getRequestHelper.
  // All the calls to getRequestHelpers should be https calls, but to keep the test suite
  // simple tests are using http calls (testing with https would require us to add tls certs
  // and configure axios to trust these tls certs, which requires an agent config, which
  // interferes a bit with how the proxies are configured since they are configured through an
  // agent themselves.
  // Proxy of https requests is still tested in the proxy-agent library itself.
  describe('Proxy configuration', () => {
    let initialHttpProxyEnv: string | undefined

    beforeAll(() => {
      initialHttpProxyEnv = process.env.HTTP_PROXY
    })

    afterAll(() => {
      if (initialHttpProxyEnv !== undefined) {
        process.env.HTTP_PROXY = initialHttpProxyEnv
      } else {
        delete process.env.HTTP_PROXY
      }
    })

    beforeEach(() => {
      delete process.env.HTTP_PROXY
    })

    // Start a target http server and a proxy server listening on localhost,
    // returns the ports they listen to, a spy method allowing us to check if they've been
    // handling any requests, and a function to close them.
    const setupServer = async () => {
      // Create target http server
      const spyTargetServer = jest.fn()
      const targetHttpServer = http.createServer((_, res) => {
        spyTargetServer()
        res.end('response from target http server')
      })
      await new Promise<void>((resolve, reject) => {
        targetHttpServer.listen().once('listening', resolve).once('error', reject)
      })

      // Create proxy
      const proxyHttpServer = http.createServer()
      const proxyServer = createProxy(proxyHttpServer)
      const spyProxyServer = jest.fn()
      proxyHttpServer.on('request', spyProxyServer)
      await new Promise<void>((resolve, reject) => {
        proxyHttpServer.listen().once('listening', resolve).once('error', reject)
      })

      return {
        proxyServer: {
          close: async () =>
            new Promise<void>((resolve, reject) => {
              proxyServer.close((err) => {
                if (err) {
                  reject(err)
                }
                resolve()
              })
            }),
          port: (proxyHttpServer.address() as AddressInfo).port,
          spy: spyProxyServer,
        },
        targetServer: {
          close: async () =>
            new Promise<void>((resolve, reject) => {
              targetHttpServer.close((err: Error | undefined) => {
                if (err) {
                  reject(err)
                }
                resolve()
              })
            }),
          port: (targetHttpServer.address() as AddressInfo).port,
          spy: spyTargetServer,
        },
      }
    }

    test('Work without a proxy defined', async () => {
      const {proxyServer, targetServer} = await setupServer()
      try {
        const requestBuilder = ciUtils.getRequestBuilder({
          apiKey: 'abc',
          baseUrl: `http://localhost:${targetServer.port}`,
        })
        await requestBuilder({
          method: 'GET',
          url: 'test-from-proxy',
        })
        expect(targetServer.spy.mock.calls.length).toBe(1)
        expect(proxyServer.spy.mock.calls.length).toBe(0)
      } finally {
        await targetServer.close()
        await proxyServer.close()
      }
    })

    test('Proxy configured explicitly', async () => {
      const {proxyServer, targetServer} = await setupServer()
      try {
        const requestBuilder = ciUtils.getRequestBuilder({
          apiKey: 'abc',
          baseUrl: `http://localhost:${targetServer.port}`,
          proxyOpts: {
            host: 'localhost',
            port: proxyServer.port,
            protocol: 'http',
          },
        })
        await requestBuilder({
          method: 'GET',
          url: 'test-from-proxy',
        })
        expect(targetServer.spy.mock.calls.length).toBe(1)
        expect(proxyServer.spy.mock.calls.length).toBe(1)
      } finally {
        await targetServer.close()
        await proxyServer.close()
      }
    })

    test('Proxy configured through env var', async () => {
      const {proxyServer, targetServer} = await setupServer()
      try {
        process.env.HTTP_PROXY = `http://localhost:${proxyServer.port}`
        const requestBuilder = ciUtils.getRequestBuilder({
          apiKey: 'abc',
          baseUrl: `http://localhost:${targetServer.port}`,
        })
        await requestBuilder({
          method: 'GET',
          url: 'test-from-proxy',
        })
        expect(targetServer.spy.mock.calls.length).toBe(1)
        expect(proxyServer.spy.mock.calls.length).toBe(1)
      } finally {
        await targetServer.close()
        await proxyServer.close()
      }
    })

    test('Proxy configured explicitly takes precedence over env var', async () => {
      const {proxyServer, targetServer} = await setupServer()
      try {
        process.env.HTTP_PROXY = `http://incorrecthost:${proxyServer.port}`
        const requestBuilder = ciUtils.getRequestBuilder({
          apiKey: 'abc',
          baseUrl: `http://localhost:${targetServer.port}`,
          proxyOpts: {
            host: 'localhost',
            port: proxyServer.port,
            protocol: 'http',
          },
        })
        await requestBuilder({
          method: 'GET',
          url: 'test-from-proxy',
        })
        expect(targetServer.spy.mock.calls.length).toBe(1)
        expect(proxyServer.spy.mock.calls.length).toBe(1)
      } finally {
        await targetServer.close()
        await proxyServer.close()
      }
    })
  })

  describe('filterAndFormatGithubRemote', () => {
    test('git remotes get formatted correctly', async () => {
      expect(ciUtils.filterAndFormatGithubRemote('https://github.com/datadog/test.git')).toEqual(
        'github.com/datadog/test.git'
      )
      expect(ciUtils.filterAndFormatGithubRemote('git@github.com:datadog/test.git')).toEqual(
        'github.com/datadog/test.git'
      )
      expect(ciUtils.filterAndFormatGithubRemote('github.com/datadog/test.git')).toEqual('github.com/datadog/test.git')
    })
  })

  describe('formatBytes', () => {
    it('returns "0 Bytes" when input is 0', () => {
      expect(formatBytes(0)).toEqual('0 Bytes')
    })

    it('returns correct format for input in Bytes', () => {
      expect(formatBytes(500)).toEqual('500 Bytes')
    })

    it('returns correct format for input in KB', () => {
      expect(formatBytes(1024)).toEqual('1 KB')
      expect(formatBytes(1500, 2)).toEqual('1.46 KB')
    })

    it('returns correct format for input in MB', () => {
      expect(formatBytes(1048576)).toEqual('1 MB')
      expect(formatBytes(1572864, 2)).toEqual('1.5 MB')
    })

    it('respects the decimal parameter and rounds up when needed', () => {
      expect(formatBytes(2313561)).toEqual('2.21 MB')
      expect(formatBytes(2313561, 0)).toEqual('2 MB')
      expect(formatBytes(2313561, 1)).toEqual('2.2 MB')
      expect(formatBytes(2313561, 3)).toEqual('2.206 MB')
    })

    it('handles negative decimals by treating them as zero', () => {
      expect(formatBytes(1572864, -1)).toEqual('2 MB')
    })

    it('throws an error if the input is negative', () => {
      expect(() => formatBytes(-1000)).toThrow()
    })
  })

  describe('maskString', () => {
    it('should make the entire string if its length is less than 12', () => {
      expect(maskString('shortString')).toEqual('****************')
    })

    it('should keep the first two and last four characters for strings longer than 12 characters', () => {
      const original = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
      const masked = 'ab**********wxyz'
      expect(maskString(original)).toEqual(masked)
    })

    it('should return <empty> if input is empty', () => {
      expect(maskString('')).toEqual('<empty>')
    })

    it('should not mask booleans', () => {
      expect(maskString('true')).toEqual('true')
      expect(maskString('TrUe')).toEqual('TrUe')
      expect(maskString('false')).toEqual('false')
      expect(maskString('FALSE')).toEqual('FALSE')
      expect(maskString('trueee')).toEqual('****************')
    })

    it('should mask API keys correctly', () => {
      expect(maskString(MOCK_DATADOG_API_KEY)).toEqual('02**********33bd')
    })
  })

  describe('isFile', () => {
    it('should determine regular file is a file', () => {
      expect(isFile('src/helpers/__tests__/utils-fixtures/file.txt')).toEqual(true)
    })

    it('should determine symlink to a file is a file', () => {
      expect(isFile('src/helpers/__tests__/utils-fixtures/file-symlink.txt')).toEqual(true)
    })

    it('should determine a folder is not a file', () => {
      expect(isFile('src/helpers/__tests__/utils-fixtures/folder')).toEqual(false)
    })

    it('should determine symlink to a folder is not a file', () => {
      expect(isFile('src/helpers/__tests__/utils-fixtures/folder-symlink')).toEqual(false)
    })
  })
})

test('removeUndefinedValues', () => {
  // eslint-disable-next-line no-null/no-null
  expect(ciUtils.removeUndefinedValues({a: 'b', c: 'd', e: undefined, g: null})).toEqual({a: 'b', c: 'd', g: null})
})
