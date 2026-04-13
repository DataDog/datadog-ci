import type * as Undici from 'undici'

jest.mock('undici', () => {
  const actualUndici = jest.requireActual<typeof Undici>('undici')

  return {
    ...actualUndici,
    fetch: jest.fn(),
  }
})

import {fetch} from 'undici'

import {httpRequest} from '../request'
import {getUserAgent, withPluginUserAgent} from '../user-agent'

type MockFetchResponse = {
  headers: {
    forEach: (callback: (value: string, key: string) => void) => void
  }
  ok: boolean
  status: number
  statusText: string
  text: () => Promise<string>
}

const mockedFetch = jest.mocked(fetch)
const getLastFetchHeaders = (): Record<string, string> => {
  const lastCall = mockedFetch.mock.calls.at(-1)
  if (!lastCall) {
    throw new Error('Expected fetch to be called')
  }

  const options = lastCall[1] as {headers: Record<string, string>}

  return options.headers
}

const createResponse = (headers: Record<string, string> = {}): MockFetchResponse => ({
  headers: {
    forEach: (callback) => {
      for (const [key, value] of Object.entries(headers)) {
        callback(value, key)
      }
    },
  },
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => '',
})

describe('httpRequest', () => {
  beforeEach(() => {
    mockedFetch.mockResolvedValue(createResponse() as Awaited<ReturnType<typeof fetch>>)
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('adds the default datadog-ci user agent header', async () => {
    await httpRequest({url: 'https://example.com'})

    expect(mockedFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    expect(getLastFetchHeaders()['User-Agent']).toBe(getUserAgent())
  })

  test('appends the active plugin token when a plugin command is running', async () => {
    await withPluginUserAgent('@datadog/datadog-ci-plugin-synthetics', '9.9.9', async () => {
      await httpRequest({url: 'https://example.com'})
    })

    expect(mockedFetch).toHaveBeenCalledWith('https://example.com', expect.any(Object))
    expect(getLastFetchHeaders()['User-Agent']).toBe(`${getUserAgent()} datadog-ci-plugin-synthetics/9.9.9`)
  })
})
