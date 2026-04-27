// os-scanner specific SBOM properties
export const LEGACY_PACKAGE_MANAGER_PROPERTY_KEY = 'osv-scanner:package-manager'
export const LEGACY_IS_DEPENDENCY_DIRECT_PROPERTY_KEY = 'osv-scanner:is-direct'
export const LEGACY_IS_DEPENDENCY_DEV_ENVIRONMENT_PROPERTY_KEY = 'osv-scanner:is-dev'

// datadog-sbom-generator specific SBOM properties
export const LEGACY_EXCLUSION_KEY = 'datadog-sbom-generator:exclusion'
export const LEGACY_REACHABLE_SYMBOL_LOCATION_KEY_PREFIX = 'datadog-sbom-generator:reachable-symbol-location'

// datadog canonical SBOM properties
export const PACKAGE_MANAGER_PROPERTY_KEY = 'datadog:package-manager'
export const IS_DEPENDENCY_DIRECT_PROPERTY_KEY = 'datadog:is-direct'
export const IS_DEPENDENCY_DEV_ENVIRONMENT_PROPERTY_KEY = 'datadog:is-dev'
export const EXCLUSION_KEY = 'datadog:exclusion'
export const REACHABLE_SYMBOL_LOCATION_KEY_PREFIX = 'datadog:reachable-symbol-location'

// datadog-sca specific SBOM properties
export const TARGET_FRAMEWORK_KEY = 'datadog:target-framework'
export const OPAQUE_KEY = 'datadog:opaque'
export const VERSION_CONSTRAINT_KEY = 'datadog:version-constraint'
