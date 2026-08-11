import {splitPatternList} from '../pattern-list'

describe('splitPatternList', () => {
  it('returns an empty list for undefined and empty values', () => {
    expect(splitPatternList(undefined)).toStrictEqual([])
    expect(splitPatternList('')).toStrictEqual([])
    expect(splitPatternList('   ')).toStrictEqual([])
    expect(splitPatternList(',,')).toStrictEqual([])
    expect(splitPatternList(' , \n , ')).toStrictEqual([])
  })

  it('splits on commas', () => {
    expect(splitPatternList('**/generated/**,src/gen/**')).toStrictEqual(['**/generated/**', 'src/gen/**'])
  })

  it('trims each pattern and drops empty ones', () => {
    expect(splitPatternList(' a , , b ,')).toStrictEqual(['a', 'b'])
  })

  it('splits on newlines', () => {
    expect(splitPatternList('a\nb\nc')).toStrictEqual(['a', 'b', 'c'])
  })

  it('splits on CRLF newlines', () => {
    expect(splitPatternList('a\r\nb\r\n')).toStrictEqual(['a', 'b'])
  })

  it('mixes commas and newlines', () => {
    expect(splitPatternList('a,b\nc,d')).toStrictEqual(['a', 'b', 'c', 'd'])
  })

  it('does not split commas inside a brace group', () => {
    expect(splitPatternList('**/*.{js,ts},src/gen/**')).toStrictEqual(['**/*.{js,ts}', 'src/gen/**'])
  })

  it('does not split commas inside nested brace groups', () => {
    expect(splitPatternList('**/{a,{b,c}}/**,src/**')).toStrictEqual(['**/{a,{b,c}}/**', 'src/**'])
  })

  it('does not split bounded regex quantifiers', () => {
    expect(splitPatternList('^src/.{2,4}/gen$,^lib/.*$')).toStrictEqual(['^src/.{2,4}/gen$', '^lib/.*$'])
  })

  it('falls back to a plain split when braces are unbalanced', () => {
    expect(splitPatternList('**/*.{js,ts')).toStrictEqual(['**/*.{js', 'ts'])
    expect(splitPatternList('a},b')).toStrictEqual(['a}', 'b'])
  })

  it('keeps negation and other glob characters verbatim', () => {
    expect(splitPatternList('!**/*.test.ts,**/*.ts')).toStrictEqual(['!**/*.test.ts', '**/*.ts'])
  })

  it('does not expand patterns against the local filesystem', () => {
    expect(splitPatternList('src/helpers/*/pattern-list.test.ts')).toStrictEqual(['src/helpers/*/pattern-list.test.ts'])
  })
})
