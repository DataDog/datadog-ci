import crypto from 'crypto'

import {enableFips, UnsupportedFipsError} from '../fips'

jest.mock('crypto')

class OpenSSLUnsupportedError extends Error {
  public code = 'ERR_OSSL_EVP_UNSUPPORTED'
}

describe('fips', () => {
  let fipsEnabled = false // mock fips being enabled in node, after calling setFips(true)
  let fipsSupported = true // mock fips being supported by node: node version >= 17
  let fipsAvailable = true // mock the fips module being available on the OS (implies fipsSupported === true)

  const getFips = crypto.getFips as jest.Mock
  const setFips = crypto.setFips as jest.Mock
  const createHash = crypto.createHash as jest.Mock

  getFips.mockImplementation(() => (fipsEnabled ? 1 : 0))
  setFips.mockImplementation((fipsValue: boolean) => {
    if (fipsSupported) {
      return (fipsEnabled = fipsValue)
    } else {
      throw new Error('FIPS mode is not supported')
    }
  })
  createHash.mockImplementation((hashFunction: string) => {
    if (fipsAvailable && hashFunction === 'md5') {
      // If fips is available, createHash should throw an error
      throw new OpenSSLUnsupportedError('error:0308010C:digital envelope routines::unsupported')
    } else {
      // Otherwise, mock the createHash monad
      return {
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hash'),
      }
    }
  })

  test('calling enableFips enables FIPS when FIPS is supported', () => {
    fipsEnabled = false
    fipsSupported = true
    fipsAvailable = true

    expect(enableFips()).toBe(true)
    expect(fipsEnabled).toBe(true)
  })

  test('calling enableFips throws when FIPS is unsupported', () => {
    fipsEnabled = false
    fipsSupported = false
    fipsAvailable = false

    expect(enableFips).toThrow(new UnsupportedFipsError())
    expect(fipsEnabled).toBe(false)
  })

  test('calling enableFips throws when FIPS is supported but unavailable', () => {
    fipsEnabled = false
    fipsSupported = true
    fipsAvailable = false

    expect(enableFips).toThrow(new UnsupportedFipsError())
    expect(fipsEnabled).toBe(true) // set to true by setFips, even though fips is unavailable
  })

  test("calling enableFips with ignoreError doesn't throw when FIPS is unsupported and unavailable", () => {
    fipsEnabled = false
    fipsSupported = false
    fipsAvailable = false
    const ignoreError = true

    expect(enableFips(ignoreError)).toBe(false)
    expect(fipsEnabled).toBe(false)
  })

  test("calling enableFips with ignoreError doesn't throw when FIPS is supported but unavailable", () => {
    fipsEnabled = false
    fipsSupported = true
    fipsAvailable = false
    const ignoreError = true

    expect(enableFips(ignoreError)).toBe(false)
    expect(fipsEnabled).toBe(true) // set to true by setFips, even though fips is unavailable
  })
})
