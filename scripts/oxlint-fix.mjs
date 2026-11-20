// `oxlint --fix` applies one set of non-overlapping fixes per run (https://github.com/oxc-project/oxc/issues/16118).
// Like ESLint, re-run it until the remaining problems stop changing.
import {spawnSync} from 'node:child_process'

// ESLint's limit of fix passes.
const maxPasses = 10

const runOxlintFix = () => spawnSync('oxlint', ['--fix', '--format', 'unix'], {encoding: 'utf8', shell: true})

const fixUntilStable = (previous, pass) => {
  const result = runOxlintFix()

  return result.stdout === previous?.stdout || pass >= maxPasses ? result : fixUntilStable(result, pass + 1)
}

const result = fixUntilStable(undefined, 1)
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exit(result.status ?? 1)
