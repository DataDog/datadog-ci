import {globAsync, globSync} from '../fs'

describe('fs', () => {
  describe('globSync', () => {
    it('uses default options', () => {
      expect(globSync('src/helpers/__tests__/*-no-mocks.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })

    it('works with dotRelative option', () => {
      expect(globSync('src/helpers/__tests__/*-no-mocks.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })
  })

  describe('globAsync', () => {
    it('uses default options', async () => {
      expect(await globAsync('src/helpers/__tests__/*-no-mocks.test.ts')).toStrictEqual([
        'src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })

    it('works with dotRelative option', async () => {
      expect(await globAsync('src/helpers/__tests__/*-no-mocks.test.ts', {dotRelative: true})).toStrictEqual([
        './src/helpers/__tests__/fs-no-mocks.test.ts',
      ])
    })
  })
})
