import {globAsync, globSync} from '../fs'

describe('Platform specific tests for FS module', () => {
  describe('globSync', () => {
    it('uses default options', () => {
      expect(globSync('src/helpers/__tests__/*.platform-specific.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs.platform-specific.test.ts',
      ])
    })

    it('works with dotRelative option', () => {
      expect(globSync('src/helpers/__tests__/*.platform-specific.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs.platform-specific.test.ts',
      ])
    })
  })

  describe('globAsync', () => {
    it('uses default options', async () => {
      expect(await globAsync('src/helpers/__tests__/*.platform-specific.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs.platform-specific.test.ts',
      ])
    })

    it('works with dotRelative option', async () => {
      expect(await globAsync('src/helpers/__tests__/*.platform-specific.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs.platform-specific.test.ts',
      ])
    })
  })
})
