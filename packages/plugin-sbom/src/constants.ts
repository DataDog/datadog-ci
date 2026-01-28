export const API_ENDPOINT = 'api/v2/static-analysis-sca/dependencies'

// os-scanner specific SBOM properties
export const PACKAGE_MANAGER_PROPERTY_KEY = 'osv-scanner:package-manager'
export const IS_DEPENDENCY_DIRECT_PROPERTY_KEY = 'osv-scanner:is-direct'
export const IS_DEPENDENCY_DEV_ENVIRONMENT_PROPERTY_KEY = 'osv-scanner:is-dev'
export const FILE_PACKAGE_PROPERTY_KEY = 'osv-scanner:package'

// datadog-sbom-generator specific SBOM properties
export const EXCLUSION_KEY = 'datadog-sbom-generator:exclusion'
export const REACHABLE_SYMBOL_LOCATION_KEY_PREFIX = 'datadog-sbom-generator:reachable-symbol-location'

// datadog-sca specific SBOM properties
export const TARGET_FRAMEWORK_KEY = 'datadog:target-framework'
