import {DependencyLicense} from './types'

// Get the license from a string. If the license is valid, we return it. Otherwise, we return undefined
const getLicenseFromString = (s: string): DependencyLicense | undefined => {
  if (!s) {
    return undefined
  }

  switch (s.toLowerCase()) {
    case '0bsd':
      return DependencyLicense.ZEROBSD
    case 'apache-2.0':
      return DependencyLicense.APACHE2
    case 'bsd-2-clause':
      return DependencyLicense.BSD2CLAUSE
    case 'bsd-3-clause':
      return DependencyLicense.BSD3CLAUSE
    case 'bsl-1.0':
      return DependencyLicense.BSL1
    case 'isc':
      return DependencyLicense.ISC
    case 'mit':
      return DependencyLicense.MIT
    case 'zlib':
      return DependencyLicense.ZLIB
  }

  console.debug(`license ${s} not recognized`)

  return undefined
}

// Get all the licenses from a string. Sometimes, there are two licenses in one string
// such as "MIT OR Apache-2.0". In this case, we return all the licenses in this condition.
export const getLicensesFromString = (s: string): DependencyLicense[] => {
  if (!s) {
    return []
  }
  const licenses: DependencyLicense[] = []

  if (s.indexOf('OR') !== -1) {
    for (const lic of s.toLowerCase().split(' or ')) {
      const l = getLicenseFromString(lic.replace(' ', ''))
      if (l) {
        licenses.push(l)
      }
    }
  } else {
    const lic = getLicenseFromString(s)
    if (lic) {
      licenses.push(lic)
    }
  }

  return licenses
}

// Get all the licenses of this component We extract the "licenses" element from the SBOM component.
// Unfortunately, depending on the SBOM generator, the licenses are generated in a different manner.
// We attempt to get as much as possible.
export const getLicensesFromComponent = (component: any): DependencyLicense[] => {
  const elementsForLicense = ['id', 'name']

  const componentName = component['name']
  const licenses: DependencyLicense[] = []

  // Get the "licenses" attribute of the SBOM component.
  if (component['licenses']) {
    for (const license of component['licenses']) {
      for (const el of elementsForLicense) {
        // Handle "license": [ {"license": {"id": <license>}}]
        if (license['license'] && license['license'][el]) {
          for (const l of getLicensesFromString(license['license'][el])) {
            licenses.push(l)
          }
        }

        // Handle "license": [ {"expression": "MIT"}]
        if (license['expression']) {
          for (const l of getLicensesFromString(license['expression'])) {
            licenses.push(l)
          }
        }
      }
    }
  }

  if (licenses.length === 0) {
    console.log(`license for component ${componentName} not found`)
  }

  return licenses
}
