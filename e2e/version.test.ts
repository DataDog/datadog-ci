import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {DATADOG_CI_COMMAND, execPromise} from './helpers/exec'

describe('version', () => {
  it('can be run without a git repository', async () => {
    // Create a temp directory (no .git) to run from, avoiding deletion of the
    // working directory's .git which would break parallel tests.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'datadog-ci-e2e-'))

    try {
      const result = await execPromise(`${DATADOG_CI_COMMAND} version`, {
        // Override HOME/CWD-like vars so git doesn't find a repo
        GIT_DIR: tmpDir,
      })

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toMatch(/^v?\d+\.\d+\.\d+/)
    } finally {
      fs.rmSync(tmpDir, {recursive: true, force: true})
    }
  })
})
