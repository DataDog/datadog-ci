import {readFile, writeFile} from 'fs/promises'
// eslint-disable-next-line no-restricted-imports
import path from 'path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

/**
 * esbuild plugin that resolves `@datadog/datadog-ci-plugin-<scope>/commands/<cmd>` imports
 * to their TypeScript source files (`packages/plugin-<scope>/src/commands/<cmd>.ts`).
 *
 * This is needed because the `./commands/*` export only has a `development` condition
 * (no `default`), so esbuild cannot resolve it without conditions: ['development'].
 * Using that flag globally breaks other packages (e.g. axios resolves to its ESM entry).
 *
 * @returns {import('esbuild').Plugin}
 */
export const resolvePluginCommandsPlugin = () => ({
  name: 'resolve-plugin-commands',
  setup: (build) => {
    build.onResolve({filter: /^@datadog\/datadog-ci-plugin-[^/]+\/commands\//}, (args) => {
      const m = args.path.match(/^@datadog\/datadog-ci-plugin-([^/]+)\/commands\/(.+)$/)
      if (!m) {
        return
      }
      const [, scope, command] = m

      return {path: path.resolve(REPO_ROOT, `packages/plugin-${scope}/src/commands/${command}.ts`)}
    })
  },
})

/**
 * esbuild plugin that appends license attributions for bundled packages that have a LICENSE
 * file but no inline license comment (which esbuild's `legalComments: 'linked'` picks up
 * automatically). Runs in the `onEnd` hook so the base .LEGAL.txt already exists.
 *
 * @returns {import('esbuild').Plugin}
 */
export const appendMissingLicensesPlugin = () => ({
  name: 'append-missing-licenses',
  setup: (build) => {
    build.onEnd(async (result) => {
      if (!result.metafile) {
        return
      }
      const {outfile} = build.initialOptions
      if (!outfile) {
        return
      }

      const legalTxtPath = `${outfile}.LEGAL.txt`
      const inputPaths = Object.keys(result.metafile.inputs)

      // Extract unique package names from node_modules paths (handles scoped packages),
      // keeping one representative input path per package to locate its root directory.
      const uniquePackages = new Map()
      for (const p of inputPaths) {
        const m = p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
        if (m && !uniquePackages.has(m[1])) {
          uniquePackages.set(m[1], p)
        }
      }

      let existing = ''
      try {
        existing = await readFile(legalTxtPath, 'utf8')
      } catch {
        existing = 'Bundled license information:\n'
      }

      const additions = []
      for (const [pkgName, inputPath] of uniquePackages) {
        if (existing.includes(`${pkgName}/`) || existing.includes(`${pkgName}:`)) {
          continue
        }

        const nodeModulesIdx = inputPath.lastIndexOf(`node_modules/${pkgName}`)
        if (nodeModulesIdx === -1) {
          continue
        }

        const pkgRoot = inputPath.slice(0, nodeModulesIdx + `node_modules/${pkgName}`.length)
        const pkgRootAbsolute = path.resolve(process.cwd(), pkgRoot)

        for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'License']) {
          try {
            const content = await readFile(path.join(pkgRootAbsolute, candidate), 'utf8')
            additions.push(`\n${pkgName}/${candidate}:\n  /*\n${content.trimEnd().replace(/^/gm, '   * ')}\n   */\n`)
            break
          } catch {
            // not found at this name, try next
          }
        }
      }

      if (additions.length > 0) {
        await writeFile(legalTxtPath, existing + additions.join(''))
      }
    })
  },
})

/**
 * @typedef {'sea' | 'npm'} BuildMode
 *
 * @typedef {Object} BuildOptions
 * @property {BuildMode} mode
 * @property {string[]} entryPoints
 * @property {string} [outfile]
 * @property {string[]} [inject]
 * @property {import('esbuild').Plugin[]} [plugins]
 * @property {Record<string, string>} [banner]
 */

/**
 * @param {BuildOptions} options
 * @returns {import('esbuild').BuildOptions}
 */
export const createBuildConfig = (options) => {
  const {mode, entryPoints, outfile, inject, plugins, banner} = options

  // SEA is built with Node.js 22, while our lowest supported version for NPM is Node.js 20.
  const target = mode === 'sea' ? 'node22' : 'node20'
  // NPM bundle uses ESM so that `import.meta.url` is defined (needed by @antfu/install-pkg).
  // SEA must stay CJS as Node.js SEA only supports CommonJS entry points.
  const format = mode === 'npm' ? 'esm' : 'cjs'

  return {
    entryPoints,
    bundle: true,
    platform: 'node',
    target,
    format,
    minify: false,
    legalComments: 'linked',
    sourcemap: true,
    metafile: true,
    preserveSymlinks: true,
    external: ['cpu-features'],
    inject: inject ?? [],
    plugins: [resolvePluginCommandsPlugin(), appendMissingLicensesPlugin(), ...(plugins ?? [])],
    ...(outfile ? {outfile} : {}),
    ...(banner ? {banner} : {}),
  }
}

export {REPO_ROOT}
