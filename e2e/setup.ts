import {Console} from 'node:console'

// Write progress as it happens rather than letting Jest attach it to each completed test.
const console = new Console({stdout: process.stdout, stderr: process.stderr})

for (const method of ['debug', 'error', 'info', 'log', 'warn'] as const) {
  const write = console[method].bind(console)
  console[method] = (...args: unknown[]) => write(`[${expect.getState().currentTestName ?? 'setup'}]`, ...args)
}

globalThis.console = console
