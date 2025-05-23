import {getLanguageFromComponent} from '../language'
import {DependencyLanguage} from '../types'

describe('getLanguageFromComponent', () => {
  it('detects NPM from bom-ref', () => {
    expect(getLanguageFromComponent({name: 'foo', 'bom-ref': 'pkg:npm/foo', purl: 'pkg:npm/foo'})).toBe(
      DependencyLanguage.NPM
    )
  })

  it('detects PHP from purl', () => {
    expect(getLanguageFromComponent({name: 'bar', 'bom-ref': 'pkg:composer/bar', purl: 'pkg:composer/bar'})).toBe(
      DependencyLanguage.PHP
    )
  })

  it('detects RUST from purl', () => {
    expect(getLanguageFromComponent({name: 'baz', 'bom-ref': 'pkg:cargo/baz', purl: 'pkg:cargo/baz'})).toBe(
      DependencyLanguage.RUST
    )
  })

  it('detects RUBY from purl', () => {
    expect(getLanguageFromComponent({name: 'qux', 'bom-ref': 'pkg:gem/qux', purl: 'pkg:gem/qux'})).toBe(
      DependencyLanguage.RUBY
    )
  })

  it('detects JVM from purl', () => {
    expect(getLanguageFromComponent({name: 'jvm', 'bom-ref': 'pkg:maven/jvm', purl: 'pkg:maven/jvm'})).toBe(
      DependencyLanguage.JVM
    )
  })

  it('detects GO from purl', () => {
    expect(getLanguageFromComponent({name: 'go', 'bom-ref': 'pkg:golang/go', purl: 'pkg:golang/go'})).toBe(
      DependencyLanguage.GO
    )
  })

  it('detects PYTHON from purl', () => {
    expect(getLanguageFromComponent({name: 'py', 'bom-ref': 'pkg:pypi/py', purl: 'pkg:pypi/py'})).toBe(
      DependencyLanguage.PYTHON
    )
  })

  it('detects DOTNET from purl', () => {
    expect(getLanguageFromComponent({name: 'dotnet', 'bom-ref': 'pkg:nuget/dotnet', purl: 'pkg:nuget/dotnet'})).toBe(
      DependencyLanguage.DOTNET
    )
  })

  it('detects C_CPP from purl', () => {
    expect(getLanguageFromComponent({name: 'cpp', 'bom-ref': 'pkg:conan/cpp', purl: 'pkg:conan/cpp'})).toBe(
      DependencyLanguage.C_CPP
    )
  })

  it('returns undefined for unknown language', () => {
    expect(
      getLanguageFromComponent({name: 'unknown', 'bom-ref': 'pkg:foo/unknown', purl: 'pkg:foo/unknown'})
    ).toBeUndefined()
  })

  it('returns undefined if no bom-ref', () => {
    expect(getLanguageFromComponent({name: 'no-bom-ref', purl: 'pkg:npm/no-bom-ref'})).toBeUndefined()
  })
})
