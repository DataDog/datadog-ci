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
    expect(getLicensesFromString('Apache License, Version 2.0')).toStrictEqual([DependencyLicense.APACHE2])
    expect(getLicensesFromString('The Apache Software License, Version 2.0')).toStrictEqual([DependencyLicense.APACHE2])
    expect(getLicensesFromString('GPL v2')).toStrictEqual([DependencyLicense.GPL2_0])

    expect(getLicensesFromString('BSD-3-Clause')).toStrictEqual([DependencyLicense.BSD3CLAUSE])
    expect(getLicensesFromString('BSD-2-Clause')).toStrictEqual([DependencyLicense.BSD2CLAUSE])
    expect(getLicensesFromString('ISC')).toStrictEqual([DependencyLicense.ISC])
    expect(getLicensesFromString('The MIT License')).toStrictEqual([DependencyLicense.MIT])
  })
})
