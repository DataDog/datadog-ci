import {Console} from 'node:console'

// Write progress as it happens rather than letting Jest attach it to each completed test.
globalThis.console = new Console({stdout: process.stdout, stderr: process.stderr})
