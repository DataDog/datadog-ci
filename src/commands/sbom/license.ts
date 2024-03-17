import {DependencyLicense} from './types'

// Get the license from a string. If the license is valid, we return it. Otherwise, we return undefined
// List of licenses: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository
const getLicenseFromString = (s: string): DependencyLicense | undefined => {
  if (!s) {
    return undefined
  }

  switch (s.toLowerCase()) {
    case '0bsd':
      return DependencyLicense.ZEROBSD
    case 'apache-2.0':
    case 'apache 2':
    case 'apache license, version 2.0':
    case 'the apache software license, version 2.0':
    case 'apache license 2.0':
    case 'apache public license 2.0':
    case 'the apache license, version 2.0':
    case 'apache license version 2.0':
      return DependencyLicense.APACHE2
    case 'bsd-2-clause':
      return DependencyLicense.BSD2CLAUSE
    case 'bsd-3-clause':
      return DependencyLicense.BSD3CLAUSE
    case 'bsl-1.0':
      return DependencyLicense.BSL1
    case 'cc0':
      return DependencyLicense.CC0_1_0
    case 'epl 1.0':
    case 'eclipse public license 1.0':
    case 'eclipse public license, version 1.0':
      return DependencyLicense.EPL1_0
    case 'eclipse public license - v 2.0':
    case 'eclipse public license v2.0':
      return DependencyLicense.EPL2_0
    case 'gpl v2':
    case 'gnu general public license, version 2 (gpl2)':
      return DependencyLicense.GPL2_0
    case 'gpl v3':
      return DependencyLicense.GPL3_0
    case 'isc':
      return DependencyLicense.ISC
    case 'mit':
    case 'the mit license':
    case 'mit license':
      return DependencyLicense.MIT
    case 'mpl-2.0':
    case 'mozilla public license, version 2.0':
      return DependencyLicense.MPL_2_0
    case 'unlicense':
      return DependencyLicense.UNLICENSE
    case 'zlib':
      return DependencyLicense.ZLIB
  }

  console.debug(`license |${s}| not recognized`)

  return undefined
}

// Get all the licenses from a string. Sometimes, there are two licenses in one string
// such as "MIT OR Apache-2.0". In this case, we return all the licenses in this condition.
export const getLicensesFromString = (s: string): DependencyLicense[] => {
  if (!s) {
    return []
  }
  const licenses: DependencyLicense[] = []

  if (s.toLowerCase().includes('or')) {
    for (const lic of s.toLowerCase().split(' or ')) {
      const l = getLicenseFromString(lic.trim())
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

// Get all the licenses of this component. We extract the "licenses" element from the SBOM component.
// Unfortunately, depending on the SBOM generator, the licenses are generated in a different manner.
// We attempt to get as much as possible.
export const getLicensesFromComponent = (component: any): DependencyLicense[] => {
  const elementsForLicense = ['id', 'name']

  const licensesSet: Set<DependencyLicense> = new Set()

  // Get the "licenses" attribute of the SBOM component.
  if (component['licenses']) {
    for (const license of component['licenses']) {
      for (const el of elementsForLicense) {
        // Handle "license": [ {"license": {"id": <license>}} ]
        if (license['license']?.[el]) {
          for (const l of getLicensesFromString(license['license'][el])) {
            licensesSet.add(l)
          }
        }
      }
      // Handle "license": [ {"expression": "MIT"} ]
      if (license['expression']) {
        for (const l of getLicensesFromString(license['expression'])) {
          licensesSet.add(l)
        }
      }
    }
  }

  return Array.from(licensesSet)
}
