import {getProxyUrl, getSyntheticsProxyDispatcher, getTunnelProxyAgent} from '../proxy'

describe('synthetics proxy helpers', () => {
  test('should return correct proxy URI', () => {
    expect(getProxyUrl()).toBe('')
    expect(getProxyUrl({protocol: 'http'})).toBe('')
    expect(getProxyUrl({host: '127.0.0.1', protocol: 'http'})).toBe('')
    expect(getProxyUrl({host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe('http://127.0.0.1:1234')

    const auth = {password: 'pwd', username: 'john'}
    expect(getProxyUrl({auth, host: '127.0.0.1', port: 1234, protocol: 'http'})).toBe(
      'http://john:pwd@127.0.0.1:1234'
    )
    expect(getProxyUrl({auth, protocol: 'http'})).toBe('')
  })

  test('should only build a dispatcher for explicit proxy configuration', () => {
    expect(getSyntheticsProxyDispatcher()).toBeUndefined()
    expect(getSyntheticsProxyDispatcher({protocol: 'http'})).toBeUndefined()
    expect(getSyntheticsProxyDispatcher({host: '127.0.0.1', port: 1234, protocol: 'http'})).toBeDefined()
  })

  test('should re-use the same tunnel proxy agent for the same proxy options', () => {
    const proxyConfig = {host: '127.0.0.1', port: 1234, protocol: 'http'} as const

    expect(getTunnelProxyAgent(proxyConfig)).toBe(getTunnelProxyAgent(proxyConfig))
  })
})
