// eslint-disable-next-line no-restricted-imports
import path from 'path'

import {defineConfig} from 'tsdown'

const DTS_TSCONFIG = path.resolve(import.meta.dirname, 'tsconfig.dts-bundle.json')

export default defineConfig({
  // Prototype only: keep tsdown output separate from the current npm packaging flow
  // so we can compare emitted JS and declarations without touching dist/.
  entry: {
    index: './src/index.ts',
  },
  format: ['cjs'],
  outDir: 'dist-tsdown-proto',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  outExtensions: () => ({js: '.js'}),
  // This is the key d.ts experiment. We reuse the checked-in tsconfig that clears
  // customConditions so workspace imports resolve through published declarations.
  dts: {
    tsconfig: DTS_TSCONFIG,
    resolver: 'tsc',
  },
})
