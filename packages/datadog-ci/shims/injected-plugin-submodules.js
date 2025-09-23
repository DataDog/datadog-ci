// This file's syntax will look broken and your IDE will complain about it, but it's expected.
// See: https://esbuild.github.io/api/#inject

// prettier-ignore
const injectedPluginSubmodules = {
  'cloud-run': {
    'instrument': require('@datadog/datadog-ci-plugin-cloud-run/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-cloud-run/commands/uninstrument'),
    'flare': require('@datadog/datadog-ci-plugin-cloud-run/commands/flare'),
  },
  'dora': {
    'deployment': require('@datadog/datadog-ci-plugin-dora/commands/deployment'),
  },
  'gate': {
    'evaluate': require('@datadog/datadog-ci-plugin-gate/commands/evaluate'),
  },
  'lambda': {
    'instrument': require('@datadog/datadog-ci-plugin-lambda/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-lambda/commands/uninstrument'),
    'flare': require('@datadog/datadog-ci-plugin-lambda/commands/flare'),
  },
  'sarif': {
    'upload': require('@datadog/datadog-ci-plugin-sarif/commands/upload'),
  },
  'sbom': {
    'upload': require('@datadog/datadog-ci-plugin-sbom/commands/upload'),
  },
  'stepfunctions': {
    'instrument': require('@datadog/datadog-ci-plugin-stepfunctions/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-stepfunctions/commands/uninstrument'),
  },
  'synthetics': {
    'run-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/run-tests'),
    'deploy-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/deploy-tests'),
    'upload-application': require('@datadog/datadog-ci-plugin-synthetics/commands/upload-application'),
    'import-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/import-tests'),
  },
}

export {injectedPluginSubmodules as '__INJECTED_PLUGIN_SUBMODULES__'}
