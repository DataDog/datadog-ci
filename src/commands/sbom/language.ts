import {DependencyLanguage} from './types'

// Attempt to find the language from a SBOM component. For now, we get the source either from
// the bom-ref or the purl property of the SBOM.
export const getLanguageFromComponent = (component: any): DependencyLanguage | undefined => {
  const componentName = component['name']

  if (component['bom-ref']) {
    if (component['bom-ref'].indexOf('pkg:npm') !== -1) {
      return DependencyLanguage.NPM
    }
    if (component['purl'].indexOf('pkg:composer') !== -1) {
      return DependencyLanguage.PHP
    }
    if (component['purl'].indexOf('pkg:cargo') !== -1) {
      return DependencyLanguage.RUST
    }
  }

  console.debug(`language for component ${componentName} not found`)

  return undefined
}
