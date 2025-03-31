import crypto from 'crypto'

import {enableFips} from '../fips'

jest.mock('crypto')

const unsupportedFipsError = new Error('error:0F06D065:common libcrypto routines:FIPS_mode_set:fips mode not supported')

const mockedSetFips = crypto.setFips as jest.MockedFunction<typeof crypto.setFips>
mockedSetFips.mockImplementation(() => {
  throw unsupportedFipsError
})

test('enableFips throws when setFips throws', () => {
  expect(() => enableFips(true)).toThrow(unsupportedFipsError)
  expect(mockedSetFips).toHaveBeenCalledWith(true)
})

test("enableFips doesn't call setFips when fips set to true", () => {
  expect(() => enableFips(false)).not.toThrow()
  expect(mockedSetFips).not.toHaveBeenCalled()
})

test('enableFips throws when setFips throws and fipsIgnoreError set to true', () => {
  expect(() => enableFips(true, false)).toThrow(unsupportedFipsError)
  expect(mockedSetFips).toHaveBeenCalledWith(true)
})

test("enableFips doesn't throw when setFips throw and fipsIgnoreError set to true", () => {
  expect(() => enableFips(true, true)).not.toThrow()
  expect(mockedSetFips).toHaveBeenCalledWith(true)
})
