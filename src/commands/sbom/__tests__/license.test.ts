import {getLicensesFromString} from '../license'
import {DependencyLicense} from '../types'

describe('licenses', () => {
  test('should return the correct values', async () => {
    expect(getLicensesFromString('MIT')).toStrictEqual([DependencyLicense.MIT])
    expect(getLicensesFromString('Apache-2.0 OR MIT')).toStrictEqual([DependencyLicense.APACHE2, DependencyLicense.MIT])
    expect(getLicensesFromString('Apache-2.0 OR   MIT')).toStrictEqual([
      DependencyLicense.APACHE2,
      DependencyLicense.MIT,
    ])
    expect(getLicensesFromString('MIT OR Apache-2.0')).toStrictEqual([DependencyLicense.MIT, DependencyLicense.APACHE2])
    expect(getLicensesFromString('MIT OR foobar')).toStrictEqual([DependencyLicense.MIT])
    expect(getLicensesFromString('foobar OR MIT')).toStrictEqual([DependencyLicense.MIT])
    expect(getLicensesFromString('')).toStrictEqual([])
    expect(getLicensesFromString('foobar')).toStrictEqual([])
  })
})
