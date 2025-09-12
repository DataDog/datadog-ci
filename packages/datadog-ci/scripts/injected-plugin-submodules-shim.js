// This file's syntax will look broken and your IDE will complain about it, but it's expected.
// See: https://esbuild.github.io/api/#inject

const injectedPluginSubmodules = {
  synthetics: {
    'deploy-tests': require('../../plugin-synthetics/dist/commands/deploy-tests'),
    'import-tests': require('../../plugin-synthetics/dist/commands/import-tests'),
    'run-tests': require('../../plugin-synthetics/dist/commands/run-tests'),
    'upload-application': require('../../plugin-synthetics/dist/commands/upload-application'),
  },
}

export {injectedPluginSubmodules as '__INJECTED_PLUGIN_SUBMODULES__'}
