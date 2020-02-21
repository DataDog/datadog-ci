// tslint:disable-next-line: no-var-requires
const glob = require('glob');

import { main } from '../index';

jest.mock('glob');

describe('index', () => {
  describe('environment keys', () => {
    test('it should exit without the right keys', async () => {
      process.env = { };

      await main();

      expect(process.exitCode).toBe(1);
    });

    test('it should exit gracefully with no tests', async () => {
      const consoleSpy = jest.spyOn(console, 'log');
      glob.glob.mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, []));
      process.env = {
        DD_API_KEY: '123',
        DD_APP_KEY: '123',
      };

      await main();

      expect(process.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith('\nNo test files found.\n');
      expect(consoleSpy).toHaveBeenCalledWith('No suites to run.');
    });
  });
});
