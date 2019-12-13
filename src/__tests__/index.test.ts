import { main } from '../index';

jest.unmock('glob');
jest.unmock('request-promise-native');

describe('index', () => {
  describe('environment keys', () => {
    let DD_API_KEY: string | undefined;
    let DD_APP_KEY: string | undefined;

    beforeEach(() => {
      DD_API_KEY = process.env.DD_API_KEY;
      DD_APP_KEY = process.env.DD_APP_KEY;
      process.env.DD_API_KEY = '123';
      process.env.DD_APP_KEY = '123';
    });

    afterEach(() => {
      delete process.exitCode;
      process.env.DD_API_KEY = DD_API_KEY;
      process.env.DD_APP_KEY = DD_APP_KEY;
    });

    test('it should exit without the right keys', async () => {
      delete process.env.DD_API_KEY;
      delete process.env.DD_APP_KEY;

      await main();

      expect(process.exitCode).toBe(1);
    });

    test('it should exit gracefully with no tests', async () => {
      const log = console.log;
      console.log = jest.fn();

      await main();

      expect(process.exitCode).toBe(0);
      expect(console.log).toHaveBeenCalledWith('\nNo test files found.\n');
      expect(console.log).toHaveBeenCalledWith('No suites to run.');

      console.log = log;
    });
  });
});
