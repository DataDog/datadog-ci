import fs from 'fs';

import { getCommandFileNames, pick } from '../utils';
jest.useFakeTimers();

describe('utils', () => {
  test('Test pick', () => {
    const initialHash = { a: 1, b: 2 };

    let resultHash = pick(initialHash, ['a']);
    expect(Object.keys(resultHash).indexOf('b')).toBe(-1);
    expect(resultHash.a).toBe(1);

    resultHash = pick(initialHash, ['c'] as any);
    expect(Object.keys(resultHash).length).toBe(0);
  });

  test('Test getCommandFileNames', () => {
    const isTrue = () => true;
    const isFalse = () => false;
    jest.spyOn(fs, 'readdirSync').mockImplementation((path: fs.PathLike) => {
      if (path === '/fake/path') {
        return [
          { isDirectory: isTrue, name: 'dir1' },
          { isDirectory: isFalse, name: 'file1' },
        ] as fs.Dirent[];
      } else if (path === '/fake/path/dir1') {
        return [
          { isFile: isFalse, name: 'subdir1' },
          { isFile: isTrue, name: 'file1.js' },
          { isFile: isTrue, name: '_file2.js' },
          { isFile: isTrue, name: 'file3.js.map' },
        ] as fs.Dirent[];
      } else {
        return [];
      }
    });
    expect([...getCommandFileNames('/fake/path')]).toEqual(['/fake/path/dir1/file1.js']);
  });
});
