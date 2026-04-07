import {readFile} from 'fs/promises'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

import {build} from 'tsdown'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')
const BUNDLE_TSCONFIG = path.join(REPO_ROOT, 'tsconfig.bundle.json')
const AXIOS_DTS_ENTRY = path.join(REPO_ROOT, 'node_modules', 'axios', 'index.d.ts')
const cwd = process.cwd()
const packageJson = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'))
const out = packageJson.types ?? packageJson.typings

if (!out) {
  throw new Error(
    'bundle-dts.mjs requires a package.json "types" or "typings" field to locate the declaration entrypoint.'
  )
}
const absOut = path.resolve(cwd, out)
const outDir = path.dirname(absOut)
const outBaseName = path.basename(absOut, '.d.ts')

// We bundle from the already-emitted `.d.ts` surface, not from source files.
// That keeps this step focused on the package publish output while still letting tsdown
// inline selected dependency types through rolldown-plugin-dts.
await build({
  entry: {
    [outBaseName]: absOut,
  },
  alias: {
    // Axios publishes separate ESM and CJS declaration entrypoints. The default resolver
    // reaches `index.d.cts`, which triggers missing named-export warnings during bundling.
    // Point directly at the ESM declarations so axios types can be inlined cleanly.
    axios: AXIOS_DTS_ENTRY,
  },
  outDir,
  format: ['esm'],
  clean: false,
  platform: 'node',
  target: 'node20',
  logLevel: 'warn',
  dts: {
    tsconfig: BUNDLE_TSCONFIG,
    dtsInput: true,
    emitDtsOnly: true,
    resolver: 'tsc',
  },
  deps: {
    // This is a declaration-only rebundle of the published type surface.
    // Inline all non-builtin dependency types so packages don't need to keep a
    // hand-maintained list of transitive type dependencies in sync over time.
    alwaysBundle: [/.*/],
    // JSON package metadata imports are part of the public surface in a few places
    // but they are not declaration bundles themselves and should stay external.
    neverBundle: [/\/package\.json$/],
  },
})
