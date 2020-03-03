jest.mock('glob');

import { Cli } from 'clipanion';

import { MainCommand } from '../index';

describe('index', () => {
  describe('environment keys', () => {
    test('it should exit without the right keys', async () => {
      process.argv = ['/path/to/node', '/path/to/datadog-ci.js', 'synthetics', 'run-tests'];

      class TestCommand extends MainCommand {
        public async execute () {
          return;
        }
      }
      TestCommand.addPath('synthetics', 'run-tests');

      const cli = new Cli();
      cli.register(TestCommand);
      const exitCode = await cli.run(process.argv.slice(2), {
        stderr: process.stderr,
        stdin: process.stdin,
        stdout: process.stdout,
      });

      expect(exitCode).toBe(1);
    });
  });
});
