import {AxiosPromise, AxiosRequestConfig, default as axios} from 'axios'
import http from 'http'
import {AddressInfo} from 'net'
import proxy from 'proxy'
import ProxyAgent from 'proxy-agent'

import * as ciUtils from '../utils'

describe('utils', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('Test pick', () => {
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
        defaultConfigPath: '/veryuniqueandabsentfile',
      })

      await expect(config).toEqual(originalConfig)
    })

    test('should have no effect if no config path nor default path are provided', async () => {
      const originalConfig = {}
      const config = await ciUtils.resolveConfigFromFile(originalConfig, {})

      await expect(config).toEqual(originalConfig)
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
        jest.spyOn(axios, 'create').mockImplementation((() => (args: AxiosRequestConfig) => args.httpsAgent) as any)
        const requestOptions = {
          apiKey: 'apiKey',
          appKey: 'applicationKey',
          baseUrl: 'http://fake-base.url/',
        }
        const request = ciUtils.getRequestBuilder(requestOptions)
        const fakeEndpoint = fakeEndpointBuilder(request)
        const httpsAgent = await fakeEndpoint()
        expect(httpsAgent).toBeDefined()
        expect(httpsAgent).toBeInstanceOf(ProxyAgent)
      })

      test('should add proxy configuration when explicitly defined', async () => {
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
      const mockCallback = jest.fn((_, res) => {
        res.end('response from target http server')
      })
      const targetHttpServer = http.createServer(mockCallback)
      await new Promise<void>((resolve, reject) => {
        targetHttpServer.listen((err: Error | undefined) => {
          if (err) {
            reject(err)
          }
          resolve()
        })
      })

      // Create proxy
      const proxyHttpServer = http.createServer()
      const proxyServer = proxy(proxyHttpServer)
      const spyProxy = jest.fn()
      proxyHttpServer.on('request', spyProxy)
      await new Promise<void>((resolve, reject) => {
        proxyServer.listen((err: Error | undefined) => {
          if (err) {
            reject(err)
          }
          resolve()
        })
      })

      return {
        proxyServer: {
          close: async () =>
            new Promise<void>((resolve, reject) => {
              proxyServer.close((err: Error) => {
                if (err) {
                  reject(err)
                }
                resolve()
              })
            }),
          port: (proxyHttpServer.address() as AddressInfo).port,
          spy: spyProxy,
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
          spy: mockCallback,
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

  describe('setApiKeyAndSiteEnvVariablesFromConfig', () => {
    test('sets the API Key and site if provided', () => {
      delete process.env.DATADOG_API_KEY
      delete process.env.DATADOG_SITE
      expect(
        ciUtils.setApiKeyAndSiteEnvVariablesFromConfig({
          apiKey: 'test_api_key',
          datadogSite: 'test_site',
        })
      )
      expect(process.env.DATADOG_API_KEY).toBe('test_api_key')
      expect(process.env.DATADOG_SITE).toBe('test_site')
    })

    test('does not crash if config is empty', () => {
      delete process.env.DATADOG_API_KEY
      delete process.env.DATADOG_SITE
      ciUtils.setApiKeyAndSiteEnvVariablesFromConfig({})
      expect(process.env.DATADOG_API_KEY).not.toBeDefined()
      expect(process.env.DATADOG_SITE).not.toBeDefined()
    })
  })
})

test('removeUndefinedValues', () => {
  // tslint:disable-next-line: no-null-keyword
  expect(ciUtils.removeUndefinedValues({a: 'b', c: 'd', e: undefined, g: null})).toEqual({a: 'b', c: 'd', g: null})
})
