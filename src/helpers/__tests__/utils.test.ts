import { getSuites, handleQuit, stopIntervals } from '../utils';
jest.useFakeTimers();
jest.mock('glob');
jest.mock('fs');

describe('utils', () => {
  describe('handleQuit', () => {
    const OLD_ON = process.on;
    const CALLS = [
      'exit',
      'SIGINT',
      'SIGUSR1',
      'SIGUSR2',
      'uncaughtException',
    ];
    beforeEach(() => {
      process.on = jest.fn();
    });
    afterEach(() => {
      process.on = OLD_ON;
    });
    test('should call stop on every quit events', () => {
      const stop = jest.fn();
      handleQuit(stop);
      expect(process.on).toHaveBeenCalledTimes(CALLS.length);
      CALLS.forEach(call => {
        expect(process.on).toHaveBeenCalledWith(call, stop);
      });
    });
  });

  test('should call clearInterval and clearTimeout', () => {
    // Need to cast as unknown because Jest Timer Mock has the wrong type.
    const timeout = setTimeout(jest.fn()) as unknown;
    const interval = setInterval(jest.fn()) as unknown;
    stopIntervals((interval as NodeJS.Timeout), (timeout as NodeJS.Timeout));
    expect(clearInterval).toHaveBeenCalledWith(interval);
    expect(clearTimeout).toHaveBeenCalledWith(timeout);
  });

  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    beforeEach(() => {
      require('glob')._setGlobs(GLOB, FILES);
      require('fs')._setFile('file1', FILES_CONTENT.file1);
      require('fs')._setFile('file2', FILES_CONTENT.file2);
    });

    test('should get suites', async () => {
      const suites = await getSuites(GLOB);
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });
});
