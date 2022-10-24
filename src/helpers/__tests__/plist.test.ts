import {parsePlist} from '../plist'

describe('plist util', () => {
  describe('parsePlist', () => {
    it('parses the content of the info plist file', () => {
      const plist = parsePlist('src/helpers/__tests__/plist-fixtures/Info.plist')
      expect(plist.getContent()).toMatchSnapshot()
    })

    it('returns the value for a property', () => {
      const plist = parsePlist('src/helpers/__tests__/plist-fixtures/Info.plist')
      expect(plist.getPropertyValue('CFBundleShortVersionString')).toBe('1.0.4')
      expect(plist.getPropertyValue('CFBundleVersion')).toBe(12)
    })

    it('throws an error if a property does not exist', () => {
      const plist = parsePlist('src/helpers/__tests__/plist-fixtures/Info.plist')
      expect(() => plist.getPropertyValue('NonExistingValue')).toThrowError('Property not found')
    })

    it('throws an error if a property is not a string', () => {
      const plist = parsePlist('src/helpers/__tests__/plist-fixtures/Info.plist')
      expect(() => plist.getPropertyValue('CFBundleURLTypes')).toThrowError(
        'Property is not a string, this is not supported yet'
      )
    })

    it('throws an error if the file does not exist', () => {
      expect(() => parsePlist('non-existing-file')).toThrowError(
        "ENOENT: no such file or directory, open 'non-existing-file'"
      )
    })
    it('throws an error if the file is not correctly formatted', () => {
      expect(() => parsePlist('src/helpers/__tests__/plist-fixtures/BadlyFormatted.plist')).toThrowError(
        "Expected closing tag 'string' (opened in line 7, col 2) instead of closing tag 'dict'."
      )
    })
  })
})
