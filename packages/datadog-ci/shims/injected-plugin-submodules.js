// This file's syntax will look broken and your IDE will complain about it, but it's expected.
// See: https://esbuild.github.io/api/#inject

// prettier-ignore
const injectedPluginSubmodules = {
  'aas': {
    'instrument': require('@datadog/datadog-ci-plugin-aas/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-aas/commands/uninstrument'),
  },
  'cloud-run': {
    'flare': require('@datadog/datadog-ci-plugin-cloud-run/commands/flare'),
    'instrument': require('@datadog/datadog-ci-plugin-cloud-run/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-cloud-run/commands/uninstrument'),
  },
  'container-app': {
    'instrument': require('@datadog/datadog-ci-plugin-container-app/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-container-app/commands/uninstrument'),
  },
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
  'lambda': {
    'flare': require('@datadog/datadog-ci-plugin-lambda/commands/flare'),
    'instrument': require('@datadog/datadog-ci-plugin-lambda/commands/instrument'),
    'uninstrument': require('@datadog/datadog-ci-plugin-lambda/commands/uninstrument'),
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
    'deploy-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/deploy-tests'),
    'import-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/import-tests'),
    'run-tests': require('@datadog/datadog-ci-plugin-synthetics/commands/run-tests'),
    'upload-application': require('@datadog/datadog-ci-plugin-synthetics/commands/upload-application'),
  },
}

export {injectedPluginSubmodules as '__INJECTED_PLUGIN_SUBMODULES__'}
