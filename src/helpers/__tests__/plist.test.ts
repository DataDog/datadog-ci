import {parsePlist} from '../plist'

describe('plist util', () => {
  describe('parsePlist', () => {
    it('parses the content of the info plist file', () => {
      const plist = parsePlist('src/helpers/__tests__/plist-fixtures/Info.plist')
      expect(plist.getContent()).toMatchSnapshot()
    })

    it('throws an error if the file does not exist', () => {})
    it('throws an error if the file is not correctly formatted', () => {})
  })
})
