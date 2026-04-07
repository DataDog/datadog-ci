// eslint-disable-next-line no-restricted-imports
import path from 'path'

import {defineConfig} from 'tsdown'

const DTS_TSCONFIG = path.resolve(import.meta.dirname, 'tsconfig.dts-bundle.json')

export default defineConfig({
  // Prototype only: keep tsdown output separate from the active esbuild-based npm bundle.
  entry: {
    cli: './src/cli.ts',
  },
  format: ['esm'],
  outDir: 'dist-tsdown-proto',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  shims: true,
  outExtensions: () => ({js: '.mjs'}),
  // Reuse the dedicated declaration config so we test whether tsdown can replace
  // the separate d.ts bundling step for the published type surface.
  dts: {
    tsconfig: DTS_TSCONFIG,
    resolver: 'tsc',
  },
})
