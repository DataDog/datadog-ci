import {DependencyLanguage} from './types'

// Attempt to find the language from a SBOM component. For now, we get the source either from
// the bom-ref or the purl property of the SBOM.
export const getLanguageFromComponent = (component: any): DependencyLanguage | undefined => {
  const componentName = component['name']

  if (component['bom-ref']) {
    if (component['bom-ref'].includes('pkg:npm')) {
      return DependencyLanguage.NPM
    }
    if (component['purl'].includes('pkg:composer')) {
      return DependencyLanguage.PHP
    }
    if (component['purl'].includes('pkg:cargo')) {
      return DependencyLanguage.RUST
    }
  }

  console.debug(`language for component ${componentName} not found`)

  return undefined
}
