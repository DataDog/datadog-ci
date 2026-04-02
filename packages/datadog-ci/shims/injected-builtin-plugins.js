// This file's syntax will look broken and your IDE will complain about it, but it's expected.
// See: https://esbuild.github.io/api/#inject
//
// This shim is used for the npm bundle. It only includes the "builtin" plugins
// that are lightweight and don't pull in cloud provider SDKs.
// The SEA binary uses injected-plugin-submodules.js which includes all plugins.

// prettier-ignore
const injectedPluginSubmodules = {
  'coverage': {
    'upload': require('@datadog/datadog-ci-plugin-coverage/commands/upload'),
  },
  'deployment': {
    'correlate-image': require('@datadog/datadog-ci-plugin-deployment/commands/correlate-image'),
    'correlate': require('@datadog/datadog-ci-plugin-deployment/commands/correlate'),
    'gate': require('@datadog/datadog-ci-plugin-deployment/commands/gate'),
    'mark': require('@datadog/datadog-ci-plugin-deployment/commands/mark'),
  },
  'dora': {
    'deployment': require('@datadog/datadog-ci-plugin-dora/commands/deployment'),
  },
  'gate': {
    'evaluate': require('@datadog/datadog-ci-plugin-gate/commands/evaluate'),
  },
  'junit': {
    'upload': require('@datadog/datadog-ci-plugin-junit/commands/upload'),
  },
  'sarif': {
    'upload': require('@datadog/datadog-ci-plugin-sarif/commands/upload'),
  },
  'sbom': {
    'upload': require('@datadog/datadog-ci-plugin-sbom/commands/upload'),
  },
}

export {injectedPluginSubmodules as '__INJECTED_PLUGIN_SUBMODULES__'}
