import fs from 'fs'

import {getBundleName, sanitizeReleaseVersion} from '../utils'

describe('react-native utils', () => {
  describe('getBundleName', () => {
    beforeEach(() => {
      jest.spyOn(fs, 'createReadStream').mockImplementation(() => undefined as any)
    })
    test('should extract the bundle name from the file ==', () => {
      expect(getBundleName('./path/index.bundle', 'android')).toBe('index.bundle')
    })

    test('should extract the bundle name from the file when no slash in path', () => {
      expect(getBundleName('index.bundle', 'android')).toBe('index.bundle')
    })

    test('should return the default iOS bundle name when no bundle is specified on iOS', () => {
      expect(getBundleName(undefined, 'ios')).toBe('main.jsbundle')
    })

    test('should return the default Android bundle name when no bundle is specified on Android', () => {
      expect(getBundleName(undefined, 'android')).toBe('index.android.bundle')
    })
  })

  describe('sanitizeReleaseVersion', () => {
    test('should remove >= prefix', () => {
      expect(sanitizeReleaseVersion('>=2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('>=1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('>=1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove <= prefix', () => {
      expect(sanitizeReleaseVersion('<=2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('<=1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('<=1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove == prefix', () => {
      expect(sanitizeReleaseVersion('==2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('==1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('==1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove = prefix', () => {
      expect(sanitizeReleaseVersion('=2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('=1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('=1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove ~ prefix', () => {
      expect(sanitizeReleaseVersion('~2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('~1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('~1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove ^ prefix', () => {
      expect(sanitizeReleaseVersion('^2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('^1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('^1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove < prefix', () => {
      expect(sanitizeReleaseVersion('<2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('<1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('<1.0.1-rc1')).toBe('1.0.1-rc1')
    })

    test('should remove > prefix', () => {
      expect(sanitizeReleaseVersion('>2.1.0')).toBe('2.1.0')
      expect(sanitizeReleaseVersion('>1.0')).toBe('1.0')
      expect(sanitizeReleaseVersion('>1.0.1-rc1')).toBe('1.0.1-rc1')
    })
  })
})
