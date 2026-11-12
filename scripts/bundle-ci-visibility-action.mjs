import {build} from 'tsdown'

await build({
  entry: {index: 'packages/ci-visibility/src/action.ts'},
  outDir: 'actions/ci-visibility-tag',
  format: ['cjs'],
  target: 'node24',
  platform: 'node',
  clean: false,
  sourcemap: false,
  outExtensions: () => ({js: '.cjs'}),
  deps: {alwaysBundle: [/.*/]},
})
