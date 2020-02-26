import * as fs from 'fs';
// tslint:disable-next-line: no-var-requires
const glob = require('glob');

import { getSuites, handleQuit, pick, stopIntervals } from '../utils';
jest.useFakeTimers();
jest.mock('glob');

describe('utils', () => {
  describe('handleQuit', () => {
    const CALLS = [
      'exit',
      'SIGINT',
      'SIGUSR1',
      'SIGUSR2',
      'uncaughtException',
    ];
    const processMock = jest.spyOn(process, 'on').mockImplementation();
    test('should call stop on every quit events', () => {
      const stop = jest.fn();
      handleQuit(stop);
      expect(processMock).toHaveBeenCalledTimes(CALLS.length);
      CALLS.forEach(call => {
        expect(processMock).toHaveBeenCalledWith(call, stop);
      });
    });
  });

  test('should call clearInterval and clearTimeout', () => {
    const timeout = setTimeout(jest.fn(), 0);
    const interval = setInterval(jest.fn(), 0);
    stopIntervals(interval, timeout);
    expect(clearInterval).toHaveBeenCalledWith(interval);
    expect(clearTimeout).toHaveBeenCalledWith(timeout);
  });

  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    jest.spyOn(fs.promises, 'readFile').mockImplementation(path =>
      Promise.resolve(FILES_CONTENT[path as 'file1' | 'file2'])
    );

    glob.glob.mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES));

    test('should get suites', async () => {
      const suites = await getSuites(GLOB);
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });

  test('Test pick', () => {
    const initialHash = { a: 1, b: 2 };

    let resultHash = pick(initialHash, ['a']);
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1);
    expect(resultHash.a).toBe(1);

    resultHash = pick(initialHash, ['c'] as any);
    expect(Object.keys(resultHash).length).toBe(0);
  });
});
