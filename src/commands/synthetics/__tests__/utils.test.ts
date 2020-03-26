jest.mock('glob');
jest.mock('fs');
jest.useFakeTimers();

import * as fs from 'fs';
import glob from 'glob';

import { getSuites } from '../utils';

describe('utils', () => {
  describe('getSuites', () => {
    const GLOB = 'testGlob';
    const FILES = [ 'file1', 'file2' ];
    const FILES_CONTENT = { file1: '{"content":"file1"}', file2: '{"content":"file2"}' };

    (fs.readFile as any).mockImplementation((path: 'file1' | 'file2', opts: any, callback: any) =>
      callback(undefined, FILES_CONTENT[path]));
    (glob as any).mockImplementation((query: string, callback: (e: any, v: any) => void) => callback(undefined, FILES));

    test('should get suites', async () => {
      const suites = await getSuites(GLOB, process.stdout.write.bind(process.stdout));
      expect(JSON.stringify(suites)).toBe(`[${FILES_CONTENT.file1},${FILES_CONTENT.file2}]`);
    });
  });
});
