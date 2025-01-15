import {DependencyLanguage} from './types'

// Attempt to find the language from a SBOM component. For now, we get the source either from
// the bom-ref or the purl property of the SBOM.
export const getLanguageFromComponent = (component: any): DependencyLanguage | undefined => {
  const componentName = component['name']

  let purlDisplay = 'N/A'

  if (component['bom-ref']) {
    if (component['purl']) {
      purlDisplay = component['purl']
    }

    if (component['bom-ref'].includes('pkg:npm') || component['purl'].includes('pkg:npm')) {
      return DependencyLanguage.NPM
    }
    if (component['purl'].includes('pkg:composer')) {
      return DependencyLanguage.PHP
    }
    if (component['purl'].includes('pkg:cargo')) {
      return DependencyLanguage.RUST
    }
    if (component['purl'].includes('pkg:gem')) {
      return DependencyLanguage.RUBY
    }
    if (component['purl'].includes('pkg:maven')) {
      return DependencyLanguage.JVM
    }
    if (component['purl'].includes('pkg:golang')) {
      return DependencyLanguage.GO
    }
    if (component['purl'].includes('pkg:pypi')) {
      return DependencyLanguage.PYTHON
    }
    if (component['purl'].includes('pkg:nuget')) {
      return DependencyLanguage.DOTNET
    }
  }

  console.debug(`language for component ${componentName} (purl: ${purlDisplay}) not found or supported`)

  return undefined
}
