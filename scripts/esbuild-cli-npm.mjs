import {writeFile} from 'fs/promises'

import chalk from 'chalk'
import {build} from 'esbuild'

import {createBuildConfig} from './esbuild-shared.mjs'

try {
  const result = await build(
    createBuildConfig({
      mode: 'npm',
      entryPoints: ['dist/cli.js'],
      outfile: 'dist/bundle.mjs',
      inject: ['shims/injected-builtin-plugins.js', 'shims/intl-collator.js'],
      // CJS modules bundled into the ESM output use `require()`. Since Node.js ESM does not
      // provide `require` in scope, we inject it via `createRequire` so those calls resolve.
      // We also define `__IS_MAIN_MODULE__` to replace the CJS `if (require.main === module)` in cli.ts
      // with an ESM equivalent. Note that it will be possible to use `import.meta.main` in Node.js 22+.
      // https://nodejs.org/api/esm.html#importmetamain
      banner: {
        // realpathSync normalises symlinks: Node.js ESM resolves import.meta.url to the real
        // path, but process.argv[1] keeps the original path (e.g. node_modules/.bin/datadog-ci
        // when invoked via npx). Without realpathSync the two paths differ and the CLI won't start.
        js: `import {createRequire} from 'module'; import {fileURLToPath} from 'url'; import {realpathSync} from 'fs'; const require = createRequire(import.meta.url); const __IS_MAIN_MODULE__ = !!process.argv[1] && (() => { try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; } })();`,
      },
    })
  )

  console.log(chalk.bold.green('npm bundle completed successfully'))
  console.log('Bundled modules:', Object.keys(result.metafile.inputs).length)

  console.log()
  console.log(`Writing metafile to ${chalk.cyan('dist/meta-npm.json')}`)
  await writeFile('dist/meta-npm.json', JSON.stringify(result.metafile, undefined, 2))

  const outputs = Object.values(result.metafile.outputs)
  const totalBytes = outputs.reduce((sum, o) => sum + o.bytes, 0)
  console.log(`Bundle size: ${chalk.bold((totalBytes / 1024 / 1024).toFixed(2))} MB`)
} catch (error) {
  console.error(chalk.red('npm bundle failed:'), error)
  process.exit(1)
}
